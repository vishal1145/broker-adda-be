import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cookieParser from "cookie-parser";

const app = express();

// middleware
app.use(helmet());
app.use(morgan("dev"));
app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS || "").split(","),
    credentials: true,
  })
);

// health check route
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Broker Adda Backend is running 🚀" });
});

export default app;
