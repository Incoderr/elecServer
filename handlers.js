const handleJoin = (socket, username, users, io) => {
    if (username && !Array.from(users.values()).includes(username)) {
      users.set(socket.id, username);
      io.emit('userList', Array.from(users.entries()).map(([id, name]) => ({ id, name })));
      socket.broadcast.emit('message', {
        user: 'System',
        text: `${username} joined the chat`,
        timestamp: new Date().toISOString()
      });
    } else {
      socket.emit('error', 'Username already taken or invalid');
    }
  };
  
  const handleChatMessage = (socket, data, users, io) => {
    const username = users.get(socket.id);
    if (username && (data.text?.trim() || data.image)) {
      io.emit('message', {
        user: username,
        text: data.text || '',
        image: data.image,
        timestamp: new Date().toISOString()
      });
    }
  };
  
  const handleDisconnect = (socket, users, io) => {
    const username = users.get(socket.id);
    if (username) {
      users.delete(socket.id);
      io.emit('userList', Array.from(users.entries()).map(([id, name]) => ({ id, name })));
      socket.broadcast.emit('message', {
        user: 'System',
        text: `${username} left the chat`,
        timestamp: new Date().toISOString()
      });
    }
  };
  
  module.exports = { handleJoin, handleChatMessage, handleDisconnect };