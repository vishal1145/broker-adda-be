import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import { errorResponse } from './utils/response.js';
import { Server } from 'socket.io';
import http from 'http';
import Message from './models/Message.js';
import Chat from './models/Chat.js';
import User from './models/User.js';
import { sendEstateMessage } from './services/botService.js';
import { createNotification } from './utils/notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
}));
// CORS configuration - Allow all origins and ports
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));

io.use(async (socket, next) => {
  try {
    socket.user = { id: socket.handshake.auth.userId };
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  socket.join(`user_${userId}`); 

  socket.on('open_chat', async ({ chatId }) => {
    socket.join(`chat_${chatId}`);
  });

// socket.on('send_message', async (data) => {
//   try {
//     const BOT_ID = "69283f29ebfd2895c80d3605";

//     // -----------------------------
//     // 1️⃣ SAVE USER MESSAGE
//     // -----------------------------
//     const msg = await Message.create({
//       chatId: data.chatId,
//       from: userId,
//       to: data.to,
//       text: data.text,
//       attachments: data.attachments || [],
//       leadCards: data.leadCards || []
//     });

//     await Chat.findByIdAndUpdate(data.chatId, {
//       lastMessage: msg._id,
//       $inc: { [`unreadCounts.${data.to}`]: 1 }
//     });

//     // Emit user message
//     io.to(`chat_${data.chatId}`).emit('message', msg);

//     // -----------------------------
//     // 2️⃣ CREATE NOTIFICATION (NON-BLOCKING)
//     // -----------------------------
//     (async () => {
//       try {
//         const fromUser = await User.findById(userId).select('name');

//         await createNotification({
//           userId: data.to,
//           type: 'message',
//           title: 'New Message',
//           message: fromUser?.name
//             ? `You have a new message from ${fromUser.name}: ${data.text.substring(0, 50)}`
//             : 'You have a new message',
//           priority: 'medium',
//           relatedEntity: {
//             entityType: 'Message',
//             entityId: msg._id
//           },
//           metadata: {
//             chatId: data.chatId,
//             messageId: msg._id
//           }
//         });
//       } catch (err) {
//         console.error('Notification error:', err);
//       }
//     })();

//     // -----------------------------
//     // 3️⃣ BOT AUTO-REPLY
//     // -----------------------------
//     if (data.to === BOT_ID) {
//       try {
//         const botReply = await sendEstateMessage({
//           question: data.text
//         });

//         console.log("Here is bot reply---------------");
//         console.log(botReply);

//         if (!botReply?.content?.length) return;

//         const botMsg = await Message.create({
//           chatId: data.chatId,
//           from: BOT_ID,
//           to: userId, // 👈 reply back to sender
//           text: botReply.content[0].text,
//           attachments: [],
//           leadCards: []
//         });

//         await Chat.findByIdAndUpdate(data.chatId, {
//           lastMessage: botMsg._id,
//           $inc: { [`unreadCounts.${userId}`]: 1 }
//         });

//         // Emit bot message (FULL OBJECT)
//         io.to(`chat_${data.chatId}`).emit('message', botMsg);

//       } catch (botError) {
//         console.error('Bot reply error:', botError);
//       }
//     }

//   } catch (err) {
//     console.error('send_message error:', err);
//   }
// });



socket.on('send_message', async (data) => {
  try {
    const BOT_ID = "69283f29ebfd2895c80d3605";

    // -----------------------------
    // 1️⃣ SAVE USER MESSAGE
    // -----------------------------
    const msg = await Message.create({
      chatId: data.chatId,
      from: userId,
      to: data.to,
      role: 'user',
      text: data.text || '',
      content: data.content || [],
      attachments: data.attachments || [],
      leadCards: data.leadCards || []
    });

    await Chat.findByIdAndUpdate(data.chatId, {
      lastMessage: msg._id,
      $inc: { [`unreadCounts.${data.to}`]: 1 }
    });

    // Emit user message
    io.to(`chat_${data.chatId}`).emit('message', msg);

    // -----------------------------
    // 2️⃣ CREATE NOTIFICATION (NON-BLOCKING)
    // -----------------------------
    (async () => {
      try {
        const fromUser = await User.findById(userId).select('name');

        await createNotification({
          userId: data.to,
          type: 'message',
          title: 'New Message',
          message: fromUser?.name
            ? `You have a new message from ${fromUser.name}: ${data.text?.substring(0, 50)}`
            : 'You have a new message',
          priority: 'medium',
          relatedEntity: {
            entityType: 'Message',
            entityId: msg._id
          },
          metadata: {
            chatId: data.chatId,
            messageId: msg._id
          }
        });
      } catch (err) {
        console.error('Notification error:', err);
      }
    })();

    // -----------------------------
    // 3️⃣ BOT AUTO-REPLY
    // -----------------------------
    if (String(data.to) === BOT_ID) {
      try {
        const botReply = await sendEstateMessage({
          question: data.text
        });

        if (!botReply?.content?.length) return;

        const botText =
          botReply.content.find(c => c.type === 'text')?.text || '';

        const botMsg = await Message.create({
          chatId: data.chatId,
          from: BOT_ID,
          to: userId,
          role: 'assistant',
          text: botText,
          content: botReply.content,
          sessionId: botReply.sessionId,
          attachments: [],
          leadCards: []
        });

        await Chat.findByIdAndUpdate(data.chatId, {
          lastMessage: botMsg._id,
          $inc: { [`unreadCounts.${userId}`]: 1 }
        });

        // Emit bot message (FULL OBJECT)
        io.to(`chat_${data.chatId}`).emit('message', botMsg);

      } catch (botError) {
        console.error('Bot reply error:', botError);
      }
    }

  } catch (err) {
    console.error('send_message error:', err);
  }
});


  socket.on('mark_read', async ({ chatId, messageIds }) => {
    await Message.updateMany({ _id: { $in: messageIds }, to: userId }, { status: 'read' });
    await Chat.findByIdAndUpdate(chatId, { $set: { [`unreadCounts.${userId}`]: 0 }});
    io.to(`chat_${chatId}`).emit('message_status', { messageIds, status: 'read', userId });
  });

  socket.on('typing', ({ chatId, isTyping }) => {
    socket.to(`chat_${chatId}`).emit('typing', { userId, isTyping });
  });


});


app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/uploads', (req, res, next) => {
  // Set CORS headers for static files
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type, Content-Disposition');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Additional headers for proper image serving
  res.header('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'SAMEORIGIN');
  
  // Allow cross-origin resource sharing for images
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
}, express.static(path.join(__dirname, 'uploads'), {
  // Additional static file options
  setHeaders: (res, path) => {
    // Set proper content type for images
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (path.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (path.endsWith('.gif')) {
      res.setHeader('Content-Type', 'image/gif');
    } else if (path.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    } else if (path.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    }
  }
}));

// Routes
app.use('/api', routes);



// 404 handler
app.use((req, res) => {
  return errorResponse(res, `Route ${req.originalUrl} not found`, 404);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global Error:', err);
  return errorResponse(res, 'Internal server error', 500, err.message);
});

export default app;
export { server };