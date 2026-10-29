
set -e


RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' 

log() {
	echo -e "${BLUE}${1}${NC}"
}

error() {
	echo -e "${RED}Error: ${1}${NC}"
}

success() {
	echo -e "${GREEN}${1}${NC}"
}

warning() {
	echo -e "${YELLOW}Warning: ${1}${NC}"
}


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PACKAGE_DIR}"


DRY_RUN=false
TAG="latest"

while [[ "$#" -gt 0 ]]; do
	case $1 in
		--dry-run) DRY_RUN=true ;;
		--tag) TAG="$2"; shift ;;
		*) echo "Unknown parameter passed: $1"; exit 1 ;;
	esac
	shift
done


NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")

log "Preparing to publish ${NAME}@${VERSION}..."


if [[ -n $(git status --porcelain) ]]; then
	warning "Working directory has uncommitted changes"
	if [ "$DRY_RUN" = false ]; then
		error "Please commit or stash changes before publishing"
		exit 1
	fi
fi


log "Running type check..."
pnpm run typecheck

log "Running linter..."
pnpm run lint

log "Running tests..."
pnpm run test

log "Building package..."
pnpm run build


if [ "$DRY_RUN" = false ]; then
	if npm view "${NAME}@${VERSION}" version >/dev/null 2>&1; then
		PUBLISHED_VERSION=$(npm view "${NAME}@${VERSION}" version)
		if [ "$PUBLISHED_VERSION" == "$VERSION" ]; then
			error "Version ${VERSION} already exists on npm registry"
			exit 1
		fi
	fi
fi


if [ "$DRY_RUN" = true ]; then
	warning "DRY RUN MODE - Not actually publishing"
	pnpm publish --dry-run --no-git-checks
	success "Dry run completed successfully!"
else
	log "Publishing to npm with tag: ${TAG}..."
	pnpm publish --tag "${TAG}" --no-git-checks
	success "Successfully published ${NAME}@${VERSION}"

	GIT_TAG="${NAME}@${VERSION}"
	log "Creating git tag: ${GIT_TAG}..."
	git tag "${GIT_TAG}"
	git push origin "${GIT_TAG}"
	success "Tag ${GIT_TAG} pushed to remote"
fi
