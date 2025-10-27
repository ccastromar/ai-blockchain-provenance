#!/bin/bash

echo "Ernest POC - Setup Script"
echo "=================================="
echo ""

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Verificar Node.js
echo -e "${BLUE}Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+ first."
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node --version)${NC}"

# Verificar Docker
echo -e "${BLUE}Checking Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo "⚠️  Docker not found. Install Docker to use docker-compose deployment."
else
    echo -e "${GREEN}✓ Docker $(docker --version)${NC}"
fi

echo ""
echo "=================================="
echo "Choose installation method:"
echo "1) Docker Compose (recommended)"
echo "2) Local development"
echo "=================================="
read -p "Enter choice [1-2]: " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo -e "${BLUE}Building and starting with Docker Compose...${NC}"
    docker-compose up --build -d
    
    echo ""
    echo -e "${GREEN}✅ Ernest is running!${NC}"
    echo ""
    echo "Access the application:"
    echo "  Frontend: http://localhost:3000"
    echo "  Backend API: http://localhost:3001"
    echo "  API Stats: http://localhost:3001/api/stats"
    echo ""
    echo "To view logs:"
    echo "  docker-compose logs -f"
    echo ""
    echo "To stop:"
    echo "  docker-compose down"
    
elif [ "$choice" = "2" ]; then
    echo ""
    echo -e "${BLUE}Setting up local development environment...${NC}"
    
    # Backend
    echo ""
    echo -e "${BLUE}Installing backend dependencies...${NC}"
    cd backend
    npm install
    
    # Crear .env si no existe
    if [ ! -f .env ]; then
        echo "Creating .env file..."
        cat > .env << EOF
PORT=3001
MONGODB_URI=mongodb://localhost:27017/ernest
NODE_ENV=development
EOF
    fi
    
    cd ..
    
    # Frontend
    echo ""
    echo -e "${BLUE}Installing frontend dependencies...${NC}"
    cd frontend
    npm install
    cd ..
    
    echo ""
    echo -e "${GREEN}✅ Setup complete!${NC}"
    echo ""
    echo "To start development:"
    echo ""
    echo "1. Start MongoDB:"
    echo "   docker run -d -p 27017:27017 --name ernest-mongo mongo:7"
    echo ""
    echo "2. Start backend (in backend/):"
    echo "   npm run start:dev"
    echo ""
    echo "3. Start frontend (in frontend/):"
    echo "   npm run dev"
    echo ""
    echo "Then access:"
    echo "  Frontend: http://localhost:3000"
    echo "  Backend API: http://localhost:3001"
    
else
    echo "Invalid choice. Exiting."
    exit 1
fi
