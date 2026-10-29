import amqp from "amqplib";
import {
	DEFAULT_DLQ_SUFFIX,
	DEFAULT_DLX_EXCHANGE,
	DEFAULT_PREFETCH_COUNT,
	EXCHANGE_TYPE,
} from "./constants.js";
import type {
	Channel,
	Connection,
	ConsumeMessage,
	ConsumeOptions,
	DlqOptions,
	ILogger,
	MessageHandler,
	PublishOptions,
	RabbitMQConfig,
} from "./types.js";
import { sanitizeError } from "./utils.js";

export class RabbitMQClient {
	private connection: Connection | null = null;
	private channel: Channel | null = null;
	private readonly logger: ILogger;
	private readonly serviceName: string;
	private readonly prefetchCount: number;
	private readonly defaultDlqOptions: Required<DlqOptions>;
	private readonly assertedQueues = new Set<string>();
	private readonly activeConsumers = new Map<
		string,
		{ handler: MessageHandler<unknown>; options?: ConsumeOptions | undefined }
	>();
	private isConnecting = false;
	private isExplicitClose = false;
	private reconnectTimer: NodeJS.Timeout | null = null;

	constructor(private readonly config: RabbitMQConfig) {
		this.serviceName = config.serviceName;
		const noop = () => {};
		const defaultLogger: ILogger = {
			info: noop,
			warn: noop,
			error: (msg, ...args) => console.error(msg, ...args),
			debug: noop,
		};
		this.logger = config.logger ?? defaultLogger;
		this.prefetchCount = config.prefetchCount ?? DEFAULT_PREFETCH_COUNT;
		this.defaultDlqOptions = {
			enabled: config.dlqOptions?.enabled ?? true,
			dlxExchange: config.dlqOptions?.dlxExchange ?? DEFAULT_DLX_EXCHANGE,
			dlqSuffix: config.dlqOptions?.dlqSuffix ?? DEFAULT_DLQ_SUFFIX,
		};
	}

	public async connect(): Promise<void> {
		if (this.isConnected()) {
			this.logger.debug?.(
				`[${this.serviceName}] RabbitMQ client already connected.`,
			);
			return;
		}

		if (this.isConnecting) {
			this.logger.debug?.(
				`[${this.serviceName}] RabbitMQ connection already in progress.`,
			);
			return;
		}

		if (!this.config.url) {
			throw new Error(`[${this.serviceName}] RabbitMQ URL is not defined`);
		}

		try {
			this.isConnecting = true;
			this.isExplicitClose = false;
			this.logger.info(
				`[${this.serviceName}] Connecting to RabbitMQ broker...`,
			);

			const connection = await amqp.connect(this.config.url);
			this.connection = connection;

			connection.on("error", (err: unknown) => {
				this.logger.error(
					`[${this.serviceName}] RabbitMQ connection error:`,
					sanitizeError(err),
				);
			});

			connection.on("close", () => {
				this.logger.warn(`[${this.serviceName}] RabbitMQ connection closed`);
				this.channel = null;
				this.connection = null;
				this.assertedQueues.clear();
				this.scheduleReconnect();
			});

			const channel = await connection.createChannel();
			this.channel = channel;

			channel.on("error", (err: unknown) => {
				this.logger.error(`[${this.serviceName}] RabbitMQ channel error:`, err);
			});

			channel.on("close", () => {
				this.logger.warn(`[${this.serviceName}] RabbitMQ channel closed`);
				this.channel = null;
				this.assertedQueues.clear();
			});

			await channel.prefetch(this.prefetchCount);

			this.logger.info(
				`[${this.serviceName}] RabbitMQ connected successfully (prefetch: ${this.prefetchCount})`,
			);
		} catch (error) {
			this.channel = null;
			this.connection = null;
			this.assertedQueues.clear();
			const sanitized = sanitizeError(error);
			this.logger.error(
				`[${this.serviceName}] Failed to connect to RabbitMQ broker:`,
				sanitized,
			);
			throw sanitized;
		} finally {
			this.isConnecting = false;
		}
	}

	private async assertQueue(
		queue: string,
		dlqOptions?: DlqOptions,
	): Promise<void> {
		if (!this.channel) {
			throw new Error(
				`[${this.serviceName}] RabbitMQ channel is not available. Call connect() first.`,
			);
		}

		const dlqEnabled = dlqOptions?.enabled ?? this.defaultDlqOptions.enabled;

		if (dlqEnabled) {
			const dlxExchange =
				dlqOptions?.dlxExchange ?? this.defaultDlqOptions.dlxExchange;
			const dlqSuffix =
				dlqOptions?.dlqSuffix ?? this.defaultDlqOptions.dlqSuffix;
			const dlqName = `${queue}${dlqSuffix}`;

			await this.channel.assertExchange(dlxExchange, EXCHANGE_TYPE.DIRECT, {
				durable: true,
			});

			await this.channel.assertQueue(dlqName, { durable: true });

			await this.channel.bindQueue(dlqName, dlxExchange, dlqName);

			await this.channel.assertQueue(queue, {
				durable: true,
				arguments: {
					"x-dead-letter-exchange": dlxExchange,
					"x-dead-letter-routing-key": dlqName,
				},
			});
		} else {
			await this.channel.assertQueue(queue, { durable: true });
		}

		this.assertedQueues.add(queue);
	}

	public async publishToQueue<T = unknown>(
		queue: string,
		message: T,
		options?: PublishOptions,
	): Promise<boolean> {
		try {
			if (!this.channel) {
				throw new Error(
					`[${this.serviceName}] RabbitMQ channel is not available. Call connect() first.`,
				);
			}

			if (!this.assertedQueues.has(queue)) {
				await this.assertQueue(queue, options?.dlq);
			}

			const payload = Buffer.from(JSON.stringify(message));
			const canContinue = this.channel.sendToQueue(queue, payload, {
				persistent: options?.persistent ?? true,
				headers: options?.headers,
			});

			if (!canContinue) {
				this.logger.warn?.(
					`[${this.serviceName}] Channel buffer full for queue "${queue}". Waiting for drain...`,
				);

				await new Promise<void>((resolve) => {
					this.channel?.once("drain", () => resolve());
				});
			}

			this.logger.debug?.(
				`[${this.serviceName}] Message published to queue "${queue}"`,
			);
			return true;
		} catch (error) {
			this.logger.error(
				`[${this.serviceName}] Failed to publish message to queue "${queue}":`,
				error,
			);
			return false;
		}
	}

	public async consumeFromQueue<T = unknown>(
		queue: string,
		handler: MessageHandler<T>,
		options?: ConsumeOptions,
	): Promise<void> {
		this.activeConsumers.set(queue, {
			handler: handler as MessageHandler<unknown>,
			options,
		});

		if (!this.channel) {
			throw new Error(
				`[${this.serviceName}] RabbitMQ channel is not available. Call connect() first.`,
			);
		}

		if (!this.assertedQueues.has(queue)) {
			await this.assertQueue(queue, options?.dlq);
		}

		const noAck = options?.noAck ?? false;
		const requeueOnFailure = options?.requeueOnFailure ?? false;

		await this.channel.consume(
			queue,
			async (msg: ConsumeMessage | null) => {
				if (!msg) {
					return;
				}

				try {
					const content = JSON.parse(msg.content.toString()) as T;
					await handler(content, msg);

					if (!noAck && this.channel) {
						this.channel.ack(msg);
					}
				} catch (error) {
					this.logger.error(
						`[${this.serviceName}] Error processing message from queue "${queue}":`,
						error,
					);

					if (!noAck && this.channel) {
						this.channel.nack(msg, false, requeueOnFailure);
					}
				}
			},
			{ noAck },
		);

		this.logger.info(`[${this.serviceName}] Subscribed to queue "${queue}"`);
	}

	public isConnected(): boolean {
		return this.channel !== null && this.connection !== null;
	}

	public getChannel(): Channel | null {
		return this.channel;
	}

	public getConnection(): Connection | null {
		return this.connection;
	}

	private scheduleReconnect(): void {
		if (this.isExplicitClose || this.reconnectTimer) {
			return;
		}

		this.logger.warn?.(
			`[${this.serviceName}] RabbitMQ connection lost. Attempting reconnect in 5 seconds...`,
		);

		this.reconnectTimer = setTimeout(async () => {
			this.reconnectTimer = null;
			try {
				await this.connect();

				for (const [
					queue,
					{ handler, options },
				] of this.activeConsumers.entries()) {
					await this.consumeFromQueue(queue, handler, options);
				}

				this.logger.info(
					`[${this.serviceName}] Reconnected to RabbitMQ and re-subscribed all consumers successfully.`,
				);
			} catch (error) {
				this.logger.error(
					`[${this.serviceName}] Reconnection attempt failed, retrying in 5 seconds...`,
					sanitizeError(error),
				);
				this.scheduleReconnect();
			}
		}, 5000);
	}

	public async close(): Promise<void> {
		try {
			this.isExplicitClose = true;
			if (this.reconnectTimer) {
				clearTimeout(this.reconnectTimer);
				this.reconnectTimer = null;
			}
			this.activeConsumers.clear();

			if (this.channel) {
				await this.channel.close();
				this.channel = null;
			}
			if (this.connection) {
				await this.connection.close();
				this.connection = null;
			}
			this.assertedQueues.clear();
			this.logger.info(
				`[${this.serviceName}] RabbitMQ connection closed gracefully`,
			);
		} catch (error) {
			this.logger.error(
				`[${this.serviceName}] Error closing RabbitMQ connection:`,
				error,
			);
		}
	}
}

export default RabbitMQClient;
