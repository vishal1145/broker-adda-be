import dotenv from "dotenv";
import app, { server } from "./src/app.js";
import connectDB from "./src/config/db.js";

dotenv.config();

// connect to MongoDB
connectDB();

// start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
