import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// MongoDB Connection URI
// Use the environment variable MONGODB_URI if available, otherwise default to localhost
export const MONGODB_URI: string = process.env.MONGODB_URI || 'mongodb://localhost:27017';

// MongoDB Database Name
export const DATABASE_NAME: string = process.env.MONGODB_DB || 'myFirstDataBase';