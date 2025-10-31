import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { createChat, getChatMessages,getMyChats } from '../controllers/chatController.js';

const router = express.Router();

router.post('/', authenticate, createChat);
router.get('/:chatId/messages', getChatMessages);
router.get('/', authenticate, getMyChats);


export default router;