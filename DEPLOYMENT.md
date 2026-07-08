# DataDive Deployment Guide

This project is structured for independent deployment of frontend and backend on Vercel.

## Project Structure

```
datadive/
├── frontend/               # React frontend app
│   ├── src/
│   ├── package.json       # Frontend dependencies
│   ├── vite.config.mjs    # Vite configuration
│   ├── vercel.json        # Vercel frontend config
│   └── .env.example
├── backend/               # Node.js API server
│   ├── api/
│   │   └── [[...slug]].js # Vercel serverless handler
│   ├── lib/               # Core business logic
│   ├── server.js          # Local dev server
│   ├── package.json       # Backend dependencies
│   ├── vercel.json        # Vercel backend config
│   └── .env.example
└── README.md
```

## Local Development

### 1. Install dependencies
```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

### 2. Set up environment variables
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit .env files with your values
```

### 3. Run locally
```bash
# Terminal 1: Backend on :8090
npm --prefix backend run dev

# Terminal 2: Frontend on :9080 (proxies /api to :8090)
npm --prefix frontend run dev
```

## Vercel Deployment

### Prerequisites
- GitHub repo pushed with both frontend and backend folders
- Vercel account

### Deploy Frontend

1. Create new Vercel project from your GitHub repo
2. Select the `frontend/` folder as root
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add environment variables:
   - `VITE_API_URL` = Your backend API URL (e.g., `https://datadive-api.vercel.app`)
6. Deploy

### Deploy Backend

1. Create new Vercel project from the same GitHub repo
2. Select the `backend/` folder as root
3. Build command: `npm install`
4. Framework: **None**
5. Add environment variables:
   - `MONGODB_URI` = Your MongoDB connection string
   - `BIFROST_API_KEY` = Your API key
   - `JWT_SECRET` = Generate a strong random secret
   - `FRONTEND_URL` = Your frontend URL (for CORS)
6. Deploy

### Connect Frontend to Backend

After deploying backend, get its URL and update frontend:
1. Go to frontend project settings in Vercel
2. Update `VITE_API_URL` environment variable to your backend URL
3. Redeploy frontend

## Environment Variables Reference

### Backend
- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB` - Database name
- `JWT_SECRET` - Secret key for JWT tokens
- `BIFROST_API_KEY` - LLM API key
- `BIFROST_URL` - LLM API URL
- `BIFROST_MODEL` - Model name (e.g., gpt-4o)
- `FRONTEND_URL` - Frontend URL for CORS
- `SEED_DEMO` - Set to 1 to seed demo data

### Frontend
- `VITE_API_URL` - Backend API URL (defaults to /api for same-origin)
