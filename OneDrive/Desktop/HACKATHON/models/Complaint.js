const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  complaintId: {
    type: String,
    required: true,
    unique: true
  },
  issueType: {
    type: String,
    required: true,
    enum: ['pothole', 'garbage', 'streetlight', 'water-leakage', 'dirty-toilet', 'other']
  },
  description: {
    type: String,
    required: true,
    maxlength: 1000
  },
  photo: {
    type: String, // File path or URL
    required: false
  },
  location: {
    latitude: {
      type: Number,
      required: true
    },
    longitude: {
      type: Number,
      required: true
    },
    address: {
      type: String,
      default: ''
    }
  },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'resolved', 'rejected'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  assignedTo: {
    type: String,
    default: ''
  },
  citizenName: {
    type: String,
    default: 'Anonymous'
  },
  citizenPhone: {
    type: String,
    default: ''
  },
  citizenEmail: {
    type: String,
    default: ''
  },
  resolutionPhoto: {
    type: String,
    default: ''
  },
  resolutionNotes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for faster queries
complaintSchema.index({ status: 1 });
complaintSchema.index({ issueType: 1 });
complaintSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Complaint', complaintSchema);
