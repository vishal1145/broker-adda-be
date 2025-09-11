import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import routes from './routes/index.js';
import { errorResponse } from './utils/response.js';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS  || 'http://localhost:3000',
  credentials: true
}));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Routes
app.use('/api', routes);

// 404 handler
app.use((req, res) => {
  return errorResponse(res, `Route ${req.originalUrl} not found`, 404);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global Error:', err);
  return errorResponse(res, 'Internal server error', 500, err.message);
});

export default app;