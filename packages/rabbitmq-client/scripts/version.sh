
set -e


RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PACKAGE_DIR}"

BUMP_TYPE=$1

if [[ -z "$BUMP_TYPE" ]]; then
	echo -e "${RED}Error: Version bump type required (patch | minor | major)${NC}"
	echo "Usage: ./scripts/version.sh [patch|minor|major]"
	exit 1
fi

echo -e "${BLUE}Bumping version (${BUMP_TYPE})...${NC}"
npm version "$BUMP_TYPE" --no-git-tag-version

NEW_VERSION=$(node -p "require('./package.json').version")
NAME=$(node -p "require('./package.json').name")

echo -e "${GREEN}Updated ${NAME} to version ${NEW_VERSION}${NC}"
