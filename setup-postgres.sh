#!/bin/bash

##############################################################################
# PostgreSQL Setup Script for Second Brain App Migration (Step 2)
#
# This script:
# 1. Verifies existing containers (Nextcloud, Vaultwarden)
# 2. Checks disk space
# 3. Deploys PostgreSQL via Docker Compose
# 4. Creates database, user, and schema
# 5. Validates health and connectivity
#
# Usage: bash setup-postgres.sh
##############################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SUCCESS=true
ERROR_MSG=""

##############################################################################
# Helper Functions
##############################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
    SUCCESS=false
    ERROR_MSG="$1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

##############################################################################
# STEP 1: Verify Existing Containers
##############################################################################

log_info "Step 1: Verifying existing containers..."

if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed or not in PATH"
    exit 1
fi

# Check Nextcloud
if docker ps --format "{{.Names}}" | grep -q nextcloud; then
    log_success "Nextcloud container is running"
else
    log_warning "Nextcloud container not found or not running"
fi

# Check Vaultwarden
if docker ps --format "{{.Names}}" | grep -q vaultwarden; then
    log_success "Vaultwarden container is running"
else
    log_warning "Vaultwarden container not found or not running"
fi

# List all running containers
log_info "Currently running containers:"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | tail -n +2 | while read -r line; do
    echo "  $line"
done

##############################################################################
# STEP 2: Check Disk Space
##############################################################################

log_info "Step 2: Checking available disk space..."

AVAILABLE_GB=$(df /var/lib/docker | awk 'NR==2 {printf "%.1f", $4/1024/1024}')
log_info "Available disk space for Docker: ${AVAILABLE_GB} GB"

if (( $(echo "$AVAILABLE_GB < 10" | bc -l) )); then
    log_error "Less than 10 GB available. PostgreSQL needs at least 10 GB free."
    exit 1
fi

log_success "Disk space check passed (${AVAILABLE_GB} GB available)"

##############################################################################
# STEP 3: Create .env File
##############################################################################

log_info "Step 3: Setting up PostgreSQL environment variables..."

ENV_FILE="$SCRIPT_DIR/.env.postgres"

if [ -f "$ENV_FILE" ]; then
    log_warning ".env.postgres already exists, skipping creation"
else
    # Generate secure random passwords
    POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')
    APP_DB_PASSWORD=$(openssl rand -base64 32 | tr -d '\n')

    cat > "$ENV_FILE" <<EOF
# PostgreSQL Configuration
POSTGRES_SUPERUSER_PASSWORD=$POSTGRES_PASSWORD
APP_DB_NAME=second_brain_app
APP_DB_USER=second_brain_app_user
APP_DB_PASSWORD=$APP_DB_PASSWORD
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
LOG_MIN_DURATION_STATEMENT=1000
EOF

    log_success "Created .env.postgres with secure random passwords"
    log_warning "Save these credentials securely:"
    log_warning "  POSTGRES_PASSWORD: $POSTGRES_PASSWORD"
    log_warning "  APP_DB_PASSWORD: $APP_DB_PASSWORD"
fi

# Load the environment
export $(cat "$ENV_FILE" | grep -v '^#' | xargs)

##############################################################################
# STEP 4: Deploy PostgreSQL via Docker Compose
##############################################################################

log_info "Step 4: Deploying PostgreSQL container..."

COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
SCHEMA_FILE="$SCRIPT_DIR/schema.sql"
INIT_SCRIPT="$SCRIPT_DIR/init-user-db.sh"

if [ ! -f "$COMPOSE_FILE" ]; then
    log_error "docker-compose.yml not found at $COMPOSE_FILE"
    exit 1
fi

if [ ! -f "$SCHEMA_FILE" ]; then
    log_error "schema.sql not found at $SCHEMA_FILE"
    exit 1
fi

if [ ! -f "$INIT_SCRIPT" ]; then
    log_error "init-user-db.sh not found at $INIT_SCRIPT"
    exit 1
fi

# Make init script executable
chmod +x "$INIT_SCRIPT"

# Start PostgreSQL container
cd "$SCRIPT_DIR"
log_info "Starting PostgreSQL container with Docker Compose..."
docker-compose up -d postgres 2>&1 | grep -v "is up to date" || true

# Wait for PostgreSQL to be ready
log_info "Waiting for PostgreSQL to initialize (up to 30 seconds)..."
RETRY_COUNT=0
MAX_RETRIES=30

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if docker exec second_brain_postgres pg_isready -U postgres &>/dev/null; then
        log_success "PostgreSQL is ready"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
        log_error "PostgreSQL failed to start after 30 seconds"
        docker logs second_brain_postgres | tail -20
        exit 1
    fi
    sleep 1
done

##############################################################################
# STEP 5: Create Database and User
##############################################################################

log_info "Step 5: Creating database and user..."

# Create database if not exists
docker exec second_brain_postgres psql -U postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname = 'second_brain_app'" | grep -q 1 || \
    docker exec second_brain_postgres psql -U postgres -c \
    "CREATE DATABASE second_brain_app OWNER postgres;"

log_success "Database 'second_brain_app' ready"

# Create user if not exists
docker exec second_brain_postgres psql -U postgres -tc \
    "SELECT 1 FROM pg_user WHERE usename = 'second_brain_app_user'" | grep -q 1 || \
    docker exec second_brain_postgres psql -U postgres -c \
    "CREATE USER second_brain_app_user WITH PASSWORD '$APP_DB_PASSWORD';"

log_success "User 'second_brain_app_user' ready"

##############################################################################
# STEP 6: Run Schema SQL
##############################################################################

log_info "Step 6: Creating schema (tables, indexes, views)..."

# Copy schema.sql into container and run it
docker cp "$SCHEMA_FILE" second_brain_postgres:/tmp/schema.sql

docker exec second_brain_postgres psql -U postgres -d second_brain_app \
    -f /tmp/schema.sql > /dev/null 2>&1

log_success "Schema created"

# Grant permissions
docker exec second_brain_postgres psql -U postgres -d second_brain_app <<EOF > /dev/null 2>&1
GRANT USAGE ON SCHEMA public TO second_brain_app_user;
GRANT CREATE ON SCHEMA public TO second_brain_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO second_brain_app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO second_brain_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO second_brain_app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO second_brain_app_user;
GRANT CONNECT ON DATABASE second_brain_app TO second_brain_app_user;
EOF

log_success "Permissions granted"

##############################################################################
# STEP 7: Health Checks & Validation
##############################################################################

log_info "Step 7: Running health checks and validation..."

# Check 1: Container is running
if docker ps --format "{{.Names}}" | grep -q second_brain_postgres; then
    log_success "Container is running"
else
    log_error "PostgreSQL container is not running"
    exit 1
fi

# Check 2: Database connectivity
if docker exec second_brain_postgres psql -U second_brain_app_user -d second_brain_app \
    -c "SELECT 1" > /dev/null 2>&1; then
    log_success "App user can connect to database"
else
    log_error "App user cannot connect to database"
    exit 1
fi

# Check 3: Schema tables exist
TABLE_COUNT=$(docker exec second_brain_postgres psql -U second_brain_app_user -d second_brain_app -tc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")

if [ "$TABLE_COUNT" -gt 0 ]; then
    log_success "Schema created with $TABLE_COUNT tables"
else
    log_error "No tables found in schema"
    exit 1
fi

# Check 4: Verify key tables exist
REQUIRED_TABLES=("users" "settings" "courses" "memories" "tasks" "calendar_events")
MISSING_TABLES=()

for table in "${REQUIRED_TABLES[@]}"; do
    if ! docker exec second_brain_postgres psql -U second_brain_app_user -d second_brain_app -tc \
        "SELECT 1 FROM information_schema.tables WHERE table_name = '$table'" | grep -q 1; then
        MISSING_TABLES+=("$table")
    fi
done

if [ ${#MISSING_TABLES[@]} -eq 0 ]; then
    log_success "All required tables exist"
else
    log_error "Missing tables: ${MISSING_TABLES[*]}"
    exit 1
fi

# Check 5: Verify views exist
VIEW_COUNT=$(docker exec second_brain_postgres psql -U second_brain_app_user -d second_brain_app -tc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'VIEW'")

log_success "Schema includes $VIEW_COUNT views"

##############################################################################
# STEP 8: Port Accessibility Check
##############################################################################

log_info "Step 8: Checking PostgreSQL port accessibility..."

# From localhost
if timeout 3 bash -c "echo > /dev/tcp/127.0.0.1/5432" 2>/dev/null; then
    log_success "PostgreSQL is accessible on localhost:5432"
else
    log_warning "PostgreSQL not accessible on 0.0.0.0:5432 (expected - should be localhost only)"
fi

# From Docker network
if docker exec second_brain_postgres timeout 3 bash -c "echo > /dev/tcp/postgres/5432" 2>/dev/null; then
    log_success "PostgreSQL is accessible within Docker network (postgres:5432)"
else
    log_error "PostgreSQL not accessible within Docker network"
    exit 1
fi

##############################################################################
# FINAL REPORT
##############################################################################

echo ""
echo "============================================================================"

if [ "$SUCCESS" = true ]; then
    echo -e "${GREEN}✓ SUCCESS${NC}: PostgreSQL is up and running!"
    echo "============================================================================"
    echo ""
    echo -e "${GREEN}Database Details:${NC}"
    echo "  Host (from Docker): postgres:5432"
    echo "  Host (from host):   127.0.0.1:5432"
    echo "  Database:           second_brain_app"
    echo "  User:               second_brain_app_user"
    echo "  Tables:             $TABLE_COUNT"
    echo ""
    echo -e "${GREEN}Next Steps:${NC}"
    echo "  1. Proceed to Step 2: Firestore export and data transformation"
    echo "  2. Use this connection string in your API backend:"
    echo "     postgres://second_brain_app_user:<password>@postgres:5432/second_brain_app"
    echo ""
    echo -e "${YELLOW}Important:${NC}"
    echo "  - Save the credentials from .env.postgres in a secure location"
    echo "  - PostgreSQL is NOT exposed to the public internet (localhost only)"
    echo "  - Credentials are stored in .env.postgres (add to .gitignore if not already)"
    echo ""
else
    echo -e "${RED}✗ FAILED${NC}: $ERROR_MSG"
    echo "============================================================================"
    echo ""
    echo -e "${RED}Debugging steps:${NC}"
    echo "  1. Check Docker is running: docker ps"
    echo "  2. Check container logs: docker logs second_brain_postgres"
    echo "  3. Verify .env.postgres exists and has correct values"
    echo ""
    exit 1
fi

exit 0
