import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import chokidar from 'chokidar';
import { appendFileSync } from 'fs';
import winston from 'winston';
import 'winston-daily-rotate-file';

// Get the current working directory outside the snapshot
const appDir = process.cwd();

// Define paths for logs and the .env file
const logDir = path.join(appDir, 'logs');
const logFilePath = path.join(logDir, 'file-mover-service.log');
const envFilePath = path.join(appDir, '.env');

// Define default environment variables
const defaultEnvContent = `SRC=./src
DEST=./dest
FILE_NAME=example.txt
`;

const transport = new winston.transports.DailyRotateFile({
    dirname: logDir,
    filename: 'file-mover-service-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,   // Compress old logs
    maxSize: '20m',        // Max size of each log file
    maxFiles: '14d',       // Keep logs for 14 days
});
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss',
        }),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),  // Also log to the console
        transport                         // Log to files with rotation
    ]
});

// Ensure the .env file exists with default values if not already present
const ensureEnvFile = async () => {
    try {
        if (!(await fs.pathExists(envFilePath))) {
            await fs.writeFile(envFilePath, defaultEnvContent, 'utf8');
            console.log(".env file created with default values.");
        }
    } catch (error) {
        console.error(`Error creating .env file: ${error}`);
        process.exit(1);
    }
};

// Ensure the logs directory exists
const ensureLogDirectory = async () => {
    try {
        await fs.ensureDir(logDir);
        console.log(`Log directory is set at: ${logDir}`);
    } catch (error) {
        console.error(`Error creating log directory: ${error}`);
        process.exit(1);
    }
};

// Load environment variables after ensuring .env exists
const loadEnv = async () => {
    await ensureEnvFile();
    dotenv.config({ path: envFilePath }); // Load environment variables from the .env file in the app directory

    // Read environment variables
    const srcDir = process.env.SRC;
    const destDir = process.env.DEST;
    const fileName = process.env.FILE_NAME;

    if (!srcDir || !destDir || !fileName) {
        console.error("Error: SRC, DEST, and FILE_NAME must be defined in the environment variables");
        process.exit(1);
    }

    return { srcDir, destDir, fileName };
};




// Function to move file with retry logic
const moveFile = async (srcPath: string, destPath: string, retries = 3) => {
    try {
        logger.info(`Attempting to move file from ${srcPath} to ${destPath}`);

        await fs.move(srcPath, destPath, { overwrite: true });

        logger.info(`File moved successfully from ${srcPath} to ${destPath}`);
    } catch (error) {
        if (retries > 0 && (error as any).code === 'EBUSY') {
            logger.warn(`File is in use. Retrying... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retrying
            await moveFile(srcPath, destPath, retries - 1); // Retry moving the file
        } else {
            logger.error(`Error moving file: ${(error as any).message}`);
        }
    }
};

// Watch the source directory for new files
const startWatching = (srcDir: string, destDir: string) => {
    const watcher = chokidar.watch(srcDir, {
        persistent: true,
        ignoreInitial: true, // Ignore files that already exist when starting
        usePolling: true, // Enable polling for better compatibility with network drives
        interval: 1000 // Polling interval
    });

    // Event listener for when a new file is added
    watcher.on('add', (filePath) => {
        const fileName = path.basename(filePath);
        const destPath = path.join(destDir, fileName);
        logger.info(`Detected new file: ${fileName}`);
        moveFile(filePath, destPath);
    });

    watcher.on('error', (error) => {
        logger.error(`Watcher error: ${error.message}`);
    });

    logger.info(`Watching directory: ${srcDir}`);
};

// Ensure log directory, load environment variables, and start watching
const startService = async () => {
    await ensureLogDirectory(); // Ensure the log directory is created
    const { srcDir, destDir, fileName } = await loadEnv(); // Load environment variables
    startWatching(srcDir, destDir); // Start watching the source directory for new files
};

// Start the service
startService();
