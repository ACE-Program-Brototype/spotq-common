import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";

export type Connection = ChannelModel;

export interface ILogger {
	info(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	debug?(message: string, ...args: unknown[]): void;
}

export interface DlqOptions {
	enabled?: boolean;
	dlxExchange?: string;
	dlqSuffix?: string;
}

export interface RabbitMQConfig {
	url: string;
	serviceName: string;
	logger?: ILogger;
	prefetchCount?: number;
	dlqOptions?: DlqOptions;
}

export interface PublishOptions {
	persistent?: boolean;
	headers?: Record<string, unknown>;
	dlq?: DlqOptions;
}

export interface ConsumeOptions {
	noAck?: boolean;
	requeueOnFailure?: boolean;
	dlq?: DlqOptions;
}

export type MessageHandler<T = unknown> = (
	content: T,
	rawMessage: ConsumeMessage,
) => Promise<void>;

export type { Channel, ChannelModel, ConsumeMessage };
