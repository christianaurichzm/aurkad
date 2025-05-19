import mongoose from 'mongoose';
import { ItemSchema } from './schemas';

export default mongoose.model('Item', ItemSchema);
