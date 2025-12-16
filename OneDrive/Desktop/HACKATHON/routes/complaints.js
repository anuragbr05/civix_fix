const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { GoogleGenerativeAI } = require("@google/generative-ai");

// In-memory storage for demo mode
let complaints = [];

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
});

// Generate unique complaint ID
function generateComplaintId() {
    const prefix = 'CIV';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

// AI Analysis Helper
async function analyzeImageWithGemini(filePath) {
    if (!process.env.GEMINI_API_KEY) {
        console.log('⚠️ No GEMINI_API_KEY found in .env. Skipping Real AI.');
        return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const imageBuffer = fs.readFileSync(filePath);
        const imagePart = {
            inlineData: {
                data: imageBuffer.toString("base64"),
                mimeType: "image/jpeg", // Assuming JPEG/PNG, Gemini handles most
            },
        };

        const prompt = `
            Analyze this civic issue image. 
            Return a purely JSON object (no markdown) with these fields:
            - issueType: One of ['pothole', 'garbage', 'streetlight', 'water-leakage', 'dirty-toilet', 'other']
            - priority: One of ['low', 'medium', 'high', 'critical']
            - description: A short 1-sentence technical description of the issue.
            
            Example: {"issueType": "pothole", "priority": "high", "description": "Large pothole in center of road."}
        `;

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        // Clean markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("AI Analysis Failed:", error.message);
        return null; // Fallback to manual
    }
}

// CREATE - Submit a new complaint
router.post('/', upload.single('photo'), async (req, res) => {
    try {
        console.log('📥 Received complaint submission');

        let { issueType, description, latitude, longitude, address, citizenName, citizenPhone, citizenEmail } = req.body;
        let aiAnalysis = null;

        // 🤖 Run AI Analysis if photo exists
        if (req.file) {
            console.log('🤖 Analyzing image with Gemini AI...');
            aiAnalysis = await analyzeImageWithGemini(req.file.path);

            if (aiAnalysis) {
                console.log('✅ AI Result:', aiAnalysis);
                // Override with AI data if confident
                issueType = aiAnalysis.issueType || issueType;

                // Append AI note to description
                const aiDesc = aiAnalysis.description ? `(AI Detected: ${aiAnalysis.description})` : '';
                description = `${description} ${aiDesc}`;
            }
        }

        if (!issueType || !latitude || !longitude) {
            // Fallback if AI failed and user didn't provide type (though frontend usually does)
            issueType = issueType || 'other';
        }

        // 🧠 SMART FALLBACK: If type is 'other', try to guess from description
        if (issueType === 'other' && description) {
            const lowerDesc = description.toLowerCase();
            if (lowerDesc.includes('road') || lowerDesc.includes('pothole') || lowerDesc.includes('crack') || lowerDesc.includes('hole')) {
                issueType = 'pothole';
            } else if (lowerDesc.includes('garbage') || lowerDesc.includes('trash') || lowerDesc.includes('waste') || lowerDesc.includes('dustbin') || lowerDesc.includes('plastic')) {
                issueType = 'garbage';
            } else if (lowerDesc.includes('light') || lowerDesc.includes('lamp') || lowerDesc.includes('dark') || lowerDesc.includes('pole')) {
                issueType = 'streetlight';
            } else if (lowerDesc.includes('water') || lowerDesc.includes('leak') || lowerDesc.includes('pipe') || lowerDesc.includes('drain') || lowerDesc.includes('sewage')) {
                issueType = 'water-leakage';
            } else if (lowerDesc.includes('toilet') || lowerDesc.includes('bathroom') || lowerDesc.includes('urinal')) {
                issueType = 'dirty-toilet';
            }
        }

        // Department Mapping
        const departmentMap = {
            'pothole': 'Roads & Highway Dept',
            'garbage': 'Sanitation Dept',
            'streetlight': 'Energy & Power Dept',
            'water-leakage': 'Water Supply Dept',
            'dirty-toilet': 'Health & Hygiene Dept',
            'other': 'General Administration'
        };
        const assignedDepartment = departmentMap[issueType] || 'General Administration';

        const now = new Date();
        const complaint = {
            _id: `mem_${Date.now()}`,
            complaintId: generateComplaintId(),
            issueType,
            description,
            department: assignedDepartment,
            location: {
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                address: address || ''
            },
            citizenName: citizenName || 'Anonymous',
            citizenPhone: citizenPhone || '',
            citizenEmail: citizenEmail || '',
            photo: req.file ? `/uploads/${req.file.filename}` : '',
            status: 'pending',
            priority: aiAnalysis?.priority || 'medium',
            assignedTo: assignedDepartment,
            aiAnalysis: aiAnalysis ? true : false,
            createdAt: now,
            updatedAt: now
        };

        complaints.push(complaint);
        console.log('✅ Complaint saved:', complaint.complaintId);

        res.status(201).json({
            success: true,
            message: 'Complaint submitted successfully',
            data: {
                complaintId: complaint.complaintId,
                status: complaint.status,
                createdAt: complaint.createdAt
            }
        });
    } catch (error) {
        console.error('❌ Error creating complaint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit complaint: ' + error.message
        });
    }
});

// READ - Get all complaints
router.get('/', async (req, res) => {
    try {
        const { status, issueType, limit = 100, skip = 0 } = req.query;

        let results = [...complaints];
        if (status) results = results.filter(c => c.status === status);
        if (issueType) results = results.filter(c => c.issueType === issueType);

        // Date filtering
        if (req.query.date) {
            const queryDate = new Date(req.query.date).toDateString();
            results = results.filter(c => new Date(c.createdAt).toDateString() === queryDate);
        }

        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const total = results.length;
        const paged = results.slice(parseInt(skip), parseInt(skip) + parseInt(limit));

        res.json({
            success: true,
            data: paged,
            total,
            limit: parseInt(limit),
            skip: parseInt(skip)
        });
    } catch (error) {
        console.error('Error fetching complaints:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch complaints'
        });
    }
});

// READ - Get complaint statistics
router.get('/stats', async (req, res) => {
    try {
        const total = complaints.length;
        const pending = complaints.filter(c => c.status === 'pending').length;
        const inProgress = complaints.filter(c => c.status === 'in-progress').length;
        const resolved = complaints.filter(c => c.status === 'resolved').length;
        const rejected = complaints.filter(c => c.status === 'rejected').length;

        const byType = {};
        complaints.forEach(c => {
            byType[c.issueType] = (byType[c.issueType] || 0) + 1;
        });

        res.json({
            success: true,
            data: {
                total,
                pending,
                inProgress,
                resolved,
                rejected,
                recentCount: total,
                byType
            }
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics'
        });
    }
});

// READ - Get single complaint by ID
router.get('/:id', async (req, res) => {
    try {
        const complaint = complaints.find(c => c.complaintId === req.params.id);

        if (!complaint) {
            return res.status(404).json({
                success: false,
                message: 'Complaint not found'
            });
        }

        res.json({
            success: true,
            data: complaint
        });
    } catch (error) {
        console.error('Error fetching complaint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch complaint'
        });
    }
});

// UPDATE - Update complaint status
router.patch('/:id', upload.single('resolutionPhoto'), async (req, res) => {
    try {
        const { status, priority, assignedTo, resolutionNotes } = req.body;

        const index = complaints.findIndex(c => c.complaintId === req.params.id);
        if (index === -1) {
            return res.status(404).json({
                success: false,
                message: 'Complaint not found'
            });
        }

        if (status) complaints[index].status = status;
        if (priority) complaints[index].priority = priority;
        if (assignedTo) complaints[index].assignedTo = assignedTo;
        if (resolutionNotes) complaints[index].resolutionNotes = resolutionNotes;
        if (req.file) complaints[index].resolutionPhoto = `/uploads/${req.file.filename}`;
        complaints[index].updatedAt = new Date();

        console.log('✅ Complaint updated:', req.params.id);

        res.json({
            success: true,
            message: 'Complaint updated successfully',
            data: complaints[index]
        });
    } catch (error) {
        console.error('Error updating complaint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update complaint'
        });
    }
});

// DELETE - Delete a complaint
router.delete('/:id', async (req, res) => {
    try {
        const index = complaints.findIndex(c => c.complaintId === req.params.id);
        if (index === -1) {
            return res.status(404).json({
                success: false,
                message: 'Complaint not found'
            });
        }

        complaints.splice(index, 1);
        console.log('✅ Complaint deleted:', req.params.id);

        res.json({
            success: true,
            message: 'Complaint deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting complaint:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete complaint'
        });
    }
});

module.exports = router;
