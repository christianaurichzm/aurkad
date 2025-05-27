import mongoose from 'mongoose';
import { ItemSchema } from './schemas.js';

export default mongoose.model('Item', ItemSchema);
