require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
// Removed express-mongo-sanitize due to compatibility issues

const app = express();
const PORT = process.env.PORT || 3000;

// Request Debugger
app.use((req, res, next) => {
    console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security Hardening
app.use(helmet({
    contentSecurityPolicy: false // Allow inline scripts for now
}));

// Simple input sanitization (replaces mongo-sanitize)
app.use((req, res, next) => {
    const sanitize = (obj) => {
        if (typeof obj === 'object' && obj !== null) {
            Object.keys(obj).forEach(key => {
                if (key.includes('$') || key.includes('.')) {
                    delete obj[key];
                } else if (typeof obj[key] === 'object') {
                    sanitize(obj[key]);
                }
            });
        }
        return obj;
    };

    if (req.body) sanitize(req.body);
    if (req.query) sanitize(req.query);
    if (req.params) sanitize(req.params);
    next();
});

// Rate Limiting (increased for development)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000, // Increased from 100 for development testing
    message: { success: false, message: 'Too many requests, please try again later.' }
});

const sosLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: { success: false, message: 'Emergency SOS limit reached. Please call emergency services directly if this is life-threatening.' }
});

const authLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 mins
    max: 10,
    message: { success: false, message: 'Too many login attempts.' }
});

app.use('/api/', apiLimiter);
app.use('/api/complaints', (req, res, next) => {
    if (req.body && req.body.isEmergency) return sosLimiter(req, res, next);
    next();
});
app.use('/api/auth', authLimiter);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/civic-platform';

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB');
    })
    .catch((err) => {
        console.log('');
        console.log('📦 DEMO MODE ACTIVE (No MongoDB)');
        console.log('   Data is stored in memory and will work for testing.');
        console.log('   To persist data, install MongoDB or use MongoDB Atlas.');
        console.log('');
    });

// In-memory Data Stores (For Demo)
const users = []; // [{ phone, citizenId, name, joinedAt }]
const otpStore = new Map(); // phone -> { otp, expires }

// Auth Routes
const authRouter = express.Router();

// 1. Send OTP
authRouter.post('/send-otp', (req, res) => {
    const { phone } = req.body;
    if (!phone || phone.length < 10) {
        return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Store with 5-minute expiry
    otpStore.set(phone, {
        otp,
        expires: Date.now() + 5 * 60 * 1000
    });

    // 📨 MOCK VIRTUAL SMS 📨
    console.log(`\n📲 [SMS GATEWAY] ------------------`);
    console.log(`📨 To: ${phone}`);
    console.log(`🔑 OTP: ${otp}`);
    console.log(`-------------------------------------\n`);

    res.json({ success: true, message: 'OTP sent successfully' });
});

// 2. Verify OTP
authRouter.post('/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    const record = otpStore.get(phone);

    if (!record) {
        return res.status(400).json({ success: false, message: 'OTP expired or not sent' });
    }

    if (record.otp !== otp) {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    if (Date.now() > record.expires) {
        otpStore.delete(phone);
        return res.status(400).json({ success: false, message: 'OTP expired' });
    }

    // OTP Valid! Clear it
    otpStore.delete(phone);

    // Find or Create User
    let user = users.find(u => u.phone === phone);
    let isNew = false;

    if (!user) {
        isNew = true;
        // Generate Privacy ID (e.g., CIT-7821)
        const citizenId = `CIT-${Math.floor(1000 + Math.random() * 9000)}`;
        user = {
            phone,
            citizenId,
            joinedAt: new Date(),
            isVerified: true
        };
        users.push(user);
    }

    console.log(`✅ User Logged In: ${phone} (${user.citizenId})`);

    res.json({
        success: true,
        message: 'Login successful',
        user: {
            phone: user.phone,
            citizenId: user.citizenId,
            joinedAt: user.joinedAt
        },
        isNew
    });
});

app.use('/api/auth', authRouter);

// API Routes
const complaintsRouter = require('./routes/complaints');
const officerAuthRouter = require('./routes/officerAuth');
const officerDashboardRouter = require('./routes/officerDashboard');
const analyticsRouter = require('./routes/analytics');
const simulationRouter = require('./routes/simulation');

app.use('/api/complaints', complaintsRouter);
app.use('/api/officer/auth', officerAuthRouter);
app.use('/api/officer/dashboard', officerDashboardRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/identity', require('./routes/identity'));
// TEMPORARILY DISABLED - Microservices causing errors
// app.use('/api/microservices', require('./routes/microservices'));
// app.use('/api/test', require('./routes/microservicesTest'));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('🔴 SERVER ERROR:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: err.message,
        stack: err.stack
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Start server (only in non-serverless environment)
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║     🏙️  CIVIC ISSUE DETECTION PLATFORM                     ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  🌐 Server running at: http://localhost:${PORT}              ║
║                                                            ║
║  📍 Citizen Portal:    http://localhost:${PORT}              ║
║  📊 Admin Dashboard:   http://localhost:${PORT}/admin.html   ║
║  📋 Report Issue:      http://localhost:${PORT}/report.html  ║
║  🔍 Track Complaint:   http://localhost:${PORT}/track.html   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
    });
}

// Export for Vercel serverless functions
module.exports = app;
