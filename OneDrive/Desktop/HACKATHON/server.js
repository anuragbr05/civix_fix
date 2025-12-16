require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// API Routes
const complaintsRouter = require('./routes/complaints');
app.use('/api/complaints', complaintsRouter);

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
    console.error('Server Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Start server
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

module.exports = app;
