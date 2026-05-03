const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const axios = require('axios');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Summary Schema
const summarySchema = new mongoose.Schema({
    title: { type: String, required: true },
    summary: { type: String, required: true },
    date: { type: Date, default: Date.now }
});

const Summary = mongoose.model('Summary', summarySchema);

process.on('exit', (code) => {
    console.log(`Process exited with code: ${code}`);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Multer setup for PDF uploads (5MB Limit)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed!'), false);
        }
    }
});

// Helper: Standardized Response
const sendResponse = (res, status, message, data = null) => {
    res.status(status === 'success' ? 200 : 400).json({
        status,
        message,
        data
    });
};

// Route 1: Upload and Extract Text
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        console.log('Received file:', req.file ? req.file.originalname : 'None');
        if (!req.file) {
            return sendResponse(res, 'error', 'No file uploaded');
        }

        const data = await pdfParse(req.file.buffer);
        console.log('Extraction success:', data.text.substring(0, 50) + '...');
        sendResponse(res, 'success', 'Text extracted successfully', { text: data.text });
    } catch (error) {
        console.error('Extraction Error Details:', error);
        sendResponse(res, 'error', 'Failed to parse PDF file: ' + error.message);
    }
});

// Route 2: Summarize Text
app.post('/api/summarize', async (req, res) => {
    const { text, length = 'medium', format = 'paragraph', title = 'Quick Summary' } = req.body;

    if (!text || text.trim().length < 50) {
        return sendResponse(res, 'error', 'Text is too short for summarization (minimum 50 characters)');
    }

    try {
        const summary = await summarizeLargeText(text, length, format);
        
        // Automatically save to history
        const newSummary = new Summary({ 
            title: title || 'Quick Summary', 
            summary 
        });
        await newSummary.save();

        sendResponse(res, 'success', 'Summary generated and saved successfully', { 
            summary,
            item: newSummary
        });
    } catch (error) {
        console.error('Summarization Error:', error.response?.data || error.message);
        const errorDetail = error.response?.data?.error || error.message;
        sendResponse(res, 'error', 'AI Summarization failed: ' + errorDetail);
    }
});

// History Routes
app.get('/api/history', async (req, res) => {
    try {
        const history = await Summary.find().sort({ date: -1 }).limit(20);
        sendResponse(res, 'success', 'History fetched', { history });
    } catch (error) {
        sendResponse(res, 'error', 'Failed to fetch history');
    }
});

app.post('/api/history', async (req, res) => {
    try {
        const { title, summary } = req.body;
        const newSummary = new Summary({ title, summary });
        await newSummary.save();
        sendResponse(res, 'success', 'Summary saved to history', { item: newSummary });
    } catch (error) {
        sendResponse(res, 'error', 'Failed to save history');
    }
});

app.delete('/api/history/:id', async (req, res) => {
    try {
        await Summary.findByIdAndDelete(req.params.id);
        sendResponse(res, 'success', 'Item deleted');
    } catch (error) {
        sendResponse(res, 'error', 'Failed to delete item');
    }
});

app.delete('/api/history-clear', async (req, res) => {
    try {
        await Summary.deleteMany({});
        sendResponse(res, 'success', 'All history cleared');
    } catch (error) {
        sendResponse(res, 'error', 'Failed to clear history');
    }
});

// AI Logic: Recursive Chunking for Large Texts
async function summarizeLargeText(text, length, format) {
    // 1. Clean the text (remove extra whitespace, newlines, and weird chars)
    const cleanedText = text
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleanedText.length < 50) return "Error: Text too short after cleaning.";

    const CHUNK_SIZE = 2000; // Safer character limit for BART (approx 500-600 tokens)
    const chunks = [];

    for (let i = 0; i < cleanedText.length; i += CHUNK_SIZE) {
        chunks.push(cleanedText.slice(i, i + CHUNK_SIZE));
    }

    console.log(`Processing ${chunks.length} chunks...`);

    const summaries = await Promise.all(chunks.map(async (chunk, index) => {
        try {
            console.log(`Summarizing chunk ${index + 1}/${chunks.length}...`);
            return await callHuggingFace(chunk, length);
        } catch (err) {
            console.error(`Failed to summarize chunk ${index + 1}:`, err.message);
            return ""; // Skip failed chunks
        }
    }));
    console.log("fullsummary ", summaries)

    let fullSummary = summaries.filter(s => s).join(' ');

    if (!fullSummary && chunks.length > 0) {
        throw new Error("AI failed to generate any summary chunks. The service might be overloaded or the text format is incompatible.");
    }

    // 2. Recursive check: If combined summary is still too long (> 3000), summarize again
    // But if they asked for 'detailed', we allow a bit more length (up to 4000)
    const MAX_SUMMARY_LENGTH = length === 'detailed' ? 4000 : 2500;

    if (fullSummary.length > MAX_SUMMARY_LENGTH) {
        console.log("Combined summary too long, summarizing again...");
        // Use a shorter length for the recursive step to ensure it actually summarizes
        const nextLength = length === 'detailed' ? 'medium' : 'short';
        fullSummary = await summarizeLargeText(fullSummary, nextLength, 'paragraph');
    }

    // 3. Final Formatting
    if (format === 'bullet') {
        return fullSummary
            .split(/[.!?]/)
            .map(s => s.trim())
            .filter(s => s.length > 10)
            .map(s => `• ${s}`)
            .join('\n');
    }

    return fullSummary;
}

// Hugging Face API Call with Retries
async function callHuggingFace(text, length, retryCount = 0) {
    const HG_API_URL = 'https://router.huggingface.co/hf-inference/models/sshleifer/distilbart-cnn-12-6';
    const MAX_RETRIES = 3;
    const MODEL_ID = 'distilbart-cnn-12-6';

    const lengthParams = {
        short: { min_length: 30, max_length: 100 },
        medium: { min_length: 80, max_length: 250 },
        detailed: { min_length: 150, max_length: 500 }
    };

    const params = lengthParams[length] || lengthParams.medium;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    try {
        const response = await fetch(HG_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: text,
                parameters: params,
                options: { wait_for_model: true }
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error || `HTTP ${response.status}`;

            // Handle Model Loading (503) or Rate Limit (429) with retries
            if ((response.status === 503 || response.status === 429) && retryCount < MAX_RETRIES) {
                const waitTime = response.status === 503 ? 5000 : 2000;
                console.log(`HF API Busy (${response.status}). Retrying in ${waitTime/1000}s... (Attempt ${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return callHuggingFace(text, length, retryCount + 1);
            }

            throw new Error(`HF API Error: ${errorMessage}`);
        }

        const data = await response.json();

        // Validate response format
        if (Array.isArray(data) && data[0]?.summary_text) {
            return data[0].summary_text;
        } else if (data.summary_text) {
            return data.summary_text;
        }

        console.warn("Unexpected HF API Response format:", JSON.stringify(data));
        return "";
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('AI request timed out after 60 seconds.');
        }
        console.error("Hugging Face Call Error:", error.message);
        throw error;
    }
}

// Error Handling Middleware for Multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return sendResponse(res, 'error', 'File size too large. Max limit is 5MB.');
        }
    }
    if (err) {
        return sendResponse(res, 'error', err.message);
    }
    next();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
