import mongoose from 'mongoose';

const staffStatsSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    claimedCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

staffStatsSchema.index({ guildId: 1, userId: 1 }, { unique: true });

export const StaffStats = mongoose.model('StaffStats', staffStatsSchema);
