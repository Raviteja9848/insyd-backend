require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 4000;
app.use(cors());
app.use(express.json());

let mode = 'memory';
let EventModel=null, NotificationModel=null;
const memory = { events: [], notifications: [] };
const MONGO_URI = process.env.MONGO_URI;
if (MONGO_URI && MONGO_URI.trim() !== '') {
  mongoose.connect(MONGO_URI).then(()=> {
    mode='mongo';
    const eventSchema = new mongoose.Schema({ eventId:String,type:String,sourceUserId:String,targetUserId:String,data:Object,timestamp:{type:Date,default:Date.now} }, {versionKey:false});
    const notificationSchema = new mongoose.Schema({ notificationId:String,type:String,content:String,sourceUserId:String,targetUserId:String,status:{type:String,default:'unread'},timestamp:{type:Date,default:Date.now} }, {versionKey:false});
    EventModel = mongoose.model('Event', eventSchema);
    NotificationModel = mongoose.model('Notification', notificationSchema);
    console.log('Mongo connected');
  }).catch(err=> { mode='memory'; console.warn('Mongo connect failed, using memory'); });
} else { console.log('No MONGO_URI, using memory storage'); }

function buildContent({type, sourceUserId, data}) {
  if(type==='like') return `User ${sourceUserId} liked your post ${data?.postId ?? ''}`.trim();
  if(type==='comment') return `User ${sourceUserId} commented on your post ${data?.postId ?? ''}`.trim();
  if(type==='follow') return `User ${sourceUserId} started following you`;
  if(type==='new_post') return `User ${sourceUserId} published a new post`;
  return data?.content || 'New notification';
}

async function saveEvent(event) {
  if(mode==='mongo' && EventModel) return await EventModel.create(event);
  memory.events.push(event); return event;
}
async function saveNotification(notification) {
  if(mode==='mongo' && NotificationModel) return await NotificationModel.create(notification);
  memory.notifications.push(notification); return notification;
}
async function getNotificationsByUser(userId) {
  if(mode==='mongo' && NotificationModel) return await NotificationModel.find({ targetUserId: userId }).sort({ timestamp: -1 }).lean();
  return memory.notifications.filter(n => n.targetUserId===userId).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
}

app.get('/health',(req,res)=> res.json({ ok:true, mode, mongoProvided:Boolean(MONGO_URI) }));

app.post('/notifications', async (req,res)=> {
  try {
    const { type='custom', sourceUserId='system', targetUserId, content } = req.body;
    if(!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });
    const notification = { notificationId: uuidv4(), type, content: content ?? buildContent({type, sourceUserId, data:{}}), sourceUserId, targetUserId, status:'unread', timestamp: new Date() };
    const saved = await saveNotification(notification);
    res.json({ notification: saved });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create notification' }); }
});

app.post('/events', async (req,res)=> {
  try {
    const { type, sourceUserId, targetUserId, data } = req.body || {};
    const allowed = new Set(['like','comment','follow','new_post','custom']);
    if (!type || !allowed.has(type)) return res.status(400).json({ error: 'Invalid or missing type' });
    if (!sourceUserId || !targetUserId) return res.status(400).json({ error: 'sourceUserId & targetUserId required' });
    const event = { eventId: uuidv4(), type, sourceUserId, targetUserId, data: data || {}, timestamp: new Date() };
    await saveEvent(event);
    const content = buildContent({ type, sourceUserId, data: data || {} });
    const notification = { notificationId: uuidv4(), type, content, sourceUserId, targetUserId, status:'unread', timestamp: new Date() };
    const savedNotification = await saveNotification(notification);
    res.json({ event, notification: savedNotification });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to process event' }); }
});

app.get('/notifications/:userId', async (req,res)=> {
  try {
    const userId = req.params.userId;
    const list = await getNotificationsByUser(userId);
    res.json({ notifications: list });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch notifications' }); }
});

app.get('/', (req,res)=> res.send('Insyd Notification Backend (POC)'));
app.listen(PORT, ()=> console.log(`Server listening on http://localhost:${PORT}`));
