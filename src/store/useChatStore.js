import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";
import { sendChannelMessage } from "../lib/socket";

export const useChatStore = create((set, get) => ({
  messages: [],
  directMessages: [],
  users: [],
  selectedFriend: null,
  selectedChannel: null, // Track currently selected channel
  isUsersLoading: false,
  isMessagesLoading: false,
  isDeletingMessage: false,
  isReacting: false,
  isSearching: false,
  searchResults: [],
  searchQuery: "",
  searchPagination: null,
  typingIndicators: {}, // Track which users are typing
  channelTypingIndicators: {}, // Track users typing in channels
  isSendingMessage: false,
  
  getCurrentChannelId: () => {
    const { selectedChannel } = get();
    return selectedChannel ? selectedChannel._id : null;
  },
  
  setSelectedChannel: (channel) => {
    set({ selectedChannel: channel });
  },
  
  setEmptyMessages: () => {
    set({ messages: [] });
  },
  
  updateSentMessage: (messageId, serverMessage) => {
    const { messages } = get();
    
    const hasTempMessage = messages.some(msg => msg._id.startsWith('temp-'));
    
    if (hasTempMessage) {
      const updatedMessages = messages.map(msg => 
        msg._id.startsWith('temp-') ? serverMessage : msg
      );
      
      set({ messages: updatedMessages });
    } else {
      set({ messages: [...messages, serverMessage] });
    }
  },

  getMessages: async (channelId) => {
    if (!channelId) return;
    
    set({ isMessagesLoading: true });
    try {
      // Set selected channel for socket filtering
      set({ selectedChannel: { _id: channelId } });
      
      const res = await axiosInstance.get(`/messages/${channelId}`);
      const messagesData = res.data.data.messages || [];
      
      set({ 
        messages: messagesData,
        directMessages: []
      });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load messages");
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  getDirectMessages: async (friendId) => {
    if (!friendId) return;
    
    set({ isMessagesLoading: true });
    try {
      // Update the route to match backend implementation
      const res = await axiosInstance.get(`/direct-messages/friend/${friendId}`);
      
      // Extract conversation data from the response
      const messagesData = res.data.data.conversation || [];
      
      // For each message, make sure it has sender information
      const processedMessages = messagesData.map(message => {
        // Structure the message for consistent UI rendering
        return {
          ...message,
          // Make sure sender information is available for display
         
        };
      });
      
      set({ 
        directMessages: processedMessages,
        messages: []
      });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to load direct messages");
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  sendMessage: async (messageData, workspaceId) => {
    if (!workspaceId) {
      
      return;
    }

    try {
      set({ isSendingMessage: true });

      // Prepare message for optimistic update
      const authUser = window.authUser || 
                      JSON.parse(localStorage.getItem('auth-store'))?.state?.authUser;
      
      if (!authUser) {
        
        toast.error("You must be logged in to send messages");
        set({ isSendingMessage: false });
        return;
      }

      // Get the channel ID from messageData or selected channel
      const { selectedChannel } = get();
      let channelId = messageData.channelId || selectedChannel?._id || workspaceId;
      
      // Create an optimistic message to show immediately
      const optimisticMessage = {
        _id: `temp-${Date.now()}`,
        content: messageData.message || messageData.content, // Support both properties
        image: messageData.image,
        senderId: authUser._id,
        userId: authUser._id,
        sender: {
          userId: authUser._id,
          username: authUser.username,
          avatar: authUser.avatar
        },
        workspaceId: workspaceId,
        channelId: channelId,
        createdAt: new Date().toISOString(),
        isSentByMe: true,
        isPending: true,
        isCode: messageData.isCode || false,
        language: messageData.language || null
      };

      // Add optimistic message to state
      set((state) => ({
        messages: [...state.messages, optimisticMessage]
      }));
      
      
      
      // Get socket from auth store
      const { socket } = useAuthStore.getState();
      
      // Try to send via socket first - this is the preferred method
      let socketSent = false;
      
      if (socket && socket.channels && socket.channels.connected) {
        
        socketSent = sendChannelMessage(
          channelId,
          {
            message: messageData.message || messageData.content,
            image: messageData.image,
            isCode: messageData.isCode || false,
            language: messageData.language || null
          },
          workspaceId
        );
        
        // Use socketSent to avoid linter error
        if (!socketSent) {
          
        } else {
          
        }
        
        // Socket handling will update the message via updateSentMessage when the server confirms
        
        // Set a timeout to mark as not pending if no server response
        setTimeout(() => {
          set((state) => {
            // Only update if message is still pending
            const isPending = state.messages.some(
              msg => msg._id === optimisticMessage._id && msg.isPending
            );
            
            if (isPending) {
              return {
                messages: state.messages.map(msg => 
                  msg._id === optimisticMessage._id ? 
                  { ...msg, isPending: false } : msg
                )
              };
            }
            return state;
          });
        }, 3000);
      } else {
        
        
        // Fall back to API if socket isn't available
        // Prepare API request data
        const apiMessageData = {
          message: messageData.message || messageData.content,
          image: messageData.image,
          isCode: messageData.isCode || false,
          language: messageData.language || null
        };
        
        // Send API request
        const response = await axiosInstance.post(
          `/messages/${channelId}`, 
          apiMessageData
        );
        
        
        
        if (response.data && response.data.data) {
          const serverData = response.data.data;
          
          // Replace optimistic message with server response
          set((state) => ({
            messages: state.messages.map(msg => 
              msg._id === optimisticMessage._id ? 
              {
                ...serverData,
                isSentByMe: true,
                isPending: false
              } : msg
            )
          }));
        } else {
          // Just mark as not pending if server data is not available
          set((state) => ({
            messages: state.messages.map(msg => 
              msg._id === optimisticMessage._id ? 
              { ...msg, isPending: false } : msg
            )
          }));
        }
      }

      set({ isSendingMessage: false });
    } catch (error) {
      
      
      // Remove the optimistic message on failure
      set((state) => ({
        messages: state.messages.filter(msg => !msg._id.startsWith('temp-')),
        isSendingMessage: false
      }));
      
      toast.error(error.response?.data?.message || "Failed to send message");
    }
  },

  sendDirectMessage: async (messageData, friendId) => {
    if (!friendId) {
      toast.error("Friend ID is required");
      return;
    }
    
    // Set sending state to prevent multiple submissions
    set({ isSendingMessage: true });
    
    // Generate a temporary ID for optimistic update
    const tempId = `temp-${Date.now()}`;
    
    // Get the current user ID
    const authUser = JSON.parse(localStorage.getItem('auth-store'))?.state?.authUser;
    
    // Create an optimistic message
    const optimisticMessage = {
      _id: tempId,
      content: messageData.message,
      image: messageData.image,
      createdAt: new Date().toISOString(),
      isSentByMe: true, // Explicitly set this for optimistic update
      isPending: true, // Flag to indicate this is a pending message
      senderId: authUser?._id || 'current-user', // Add user ID to ensure proper positioning
      sender: {
        userId: authUser?._id || 'current-user',
        username: authUser?.username || 'You',
        avatar: authUser?.avatar
      },
      isCode: false,      // Preserve isCode flag
      language: messageData.language || null    // Preserve language
    };
    
    // Add the optimistic message to the UI immediately
    set((state) => ({
      directMessages: [...state.directMessages, optimisticMessage]
    }));
    
    try {
      // Disable the send button for this message
      const sendButton = document.querySelector(`button[type="submit"]`);
      if (sendButton) {
        sendButton.disabled = true;
      }
      
      const requestData = {
        content: messageData.message,
        isCode: false,      // Use isCode from messageData if provided
        language: messageData.language || "text",  // Use language from messageData if provided
        image: messageData.image
      };
      
      const response = await axiosInstance.post(
        `/direct-messages/friend/${friendId}`, 
        requestData
      );
      
      const newMessage = response.data.data;
      

      // Replace the optimistic message with the real one, ensuring correct structure
      set((state) => ({
        directMessages: state.directMessages.map(msg => 
          msg._id === tempId ? { 
            ...newMessage,
            _id: newMessage.messageId || newMessage._id, // Ensure messageId is properly mapped to _id
            isSentByMe: true // Make sure this is explicitly set
          } : msg
        )
      }));
      
      return newMessage;
    } catch (error) {
      
      if (error.response?.data?.message) {
        toast.error(error.response.data.message);
      } else {
        toast.error("Failed to send direct message");
      }
      
      // Remove the failed optimistic message
      set((state) => ({
        directMessages: state.directMessages.filter(msg => msg._id !== tempId)
      }));
    } finally {
      // Enable the send button again
      const sendButton = document.querySelector(`button[type="submit"]`);
      if (sendButton) {
        sendButton.disabled = false;
      }
      set({ isSendingMessage: false });
    }
  },

  deleteMessage: async (messageId, channelId, isDirect = false) => {
    try {
      set({ isDeletingMessage: true });
      
      if (!isDirect) {
        // For channel messages
        try {
          // Import the socket function for channels
          const { deleteMessage } = await import("../lib/socket");
          
          // Try socket approach first for channel messages
          if (deleteMessage(messageId, channelId)) {
            
          } else {
            // Fall back to API if socket approach fails
            
            await axiosInstance.delete(`/messages/${messageId}`);
            // Update state locally when using API
            get().removeChannelMessage(messageId);
          }
        } catch (err) {
          // Handle any socket-related errors
          
          await axiosInstance.delete(`/messages/${messageId}`);
          get().removeChannelMessage(messageId);
        }
      } else {
        // For direct messages
        try {
          // Import the socket function for direct messages
          const { deleteDirectMessage } = await import("../lib/socket");
          
          // Try socket approach first for direct messages
          if (deleteDirectMessage(messageId)) {
            
          } else {
            // Fall back to API if socket approach fails
            
            await axiosInstance.delete(`/direct-messages/${messageId}`);
            // Update state locally when using API
            get().removeDirectMessage(messageId);
          }
        } catch (err) {
          // Handle any socket-related errors
          
          await axiosInstance.delete(`/direct-messages/${messageId}`);
          get().removeDirectMessage(messageId);
        }
      }
    } catch (error) {
      
      toast.error("Failed to delete message");
    } finally {
      set({ isDeletingMessage: false });
    }
  },
  
  reactToMessage: async (messageId, emoji, channelId, userId) => {
    
    
    if (!messageId) {
      
      toast.error("Message ID is required");
      return;
    }
    
    if (!emoji) {
      
      toast.error("Emoji is required");
      return;
    }
    
    if (!channelId) {
      
      toast.error("Channel ID is required to add reactions");
      return;
    }
    
    if (!userId) {
      
      toast.error("User not authenticated");
      return;
    }
    
    set({ isReacting: true });
    try {
      
      const response = await axiosInstance.post(`/messages/${messageId}/react`, { emoji });
      
      
      // Optimistic update - add/toggle user's reaction
      const { messages } = get();
      
      const updatedMessages = messages.map(message => {
        if (message._id === messageId) {
          // Clone the message to avoid direct state mutation
          const updatedMessage = { ...message };
          
          // Initialize reactions array if it doesn't exist
          if (!updatedMessage.reactions) {
            updatedMessage.reactions = [];
          }
          
          // Find if this emoji reaction already exists
          const existingReactionIndex = updatedMessage.reactions.findIndex(
            reaction => reaction.emoji === emoji
          );
          
          if (existingReactionIndex !== -1) {
            // Check if user already reacted with this emoji
            const reaction = { ...updatedMessage.reactions[existingReactionIndex] };
            
            // Initialize users array if it doesn't exist
            if (!reaction.users) {
              reaction.users = [];
            }
            
            const userReactedIndex = reaction.users.findIndex(
              id => id === userId || id._id === userId
            );
            
            if (userReactedIndex !== -1) {
              // User already reacted, remove their reaction
              const updatedUsers = [...reaction.users];
              updatedUsers.splice(userReactedIndex, 1);
              reaction.users = updatedUsers;
              
              // If no users left for this reaction, remove it
              if (reaction.users.length === 0) {
                const updatedReactions = [...updatedMessage.reactions];
                updatedReactions.splice(existingReactionIndex, 1);
                updatedMessage.reactions = updatedReactions;
              } else {
                // Otherwise update the reaction with new users list
                const updatedReactions = [...updatedMessage.reactions];
                updatedReactions[existingReactionIndex] = reaction;
                updatedMessage.reactions = updatedReactions;
              }
            } else {
              // Add user to existing reaction
              const updatedReactions = [...updatedMessage.reactions];
              updatedReactions[existingReactionIndex] = {
                ...reaction,
                users: [...reaction.users, userId]
              };
              updatedMessage.reactions = updatedReactions;
            }
          } else {
            // Create new reaction
            updatedMessage.reactions = [
              ...updatedMessage.reactions,
              {
                emoji,
                users: [userId]
              }
            ];
          }
          
          return updatedMessage;
        }
        return message;
      });
      
      set({ messages: updatedMessages });
      
    } catch (error) {
      
      
      toast.error(error.response?.data?.message || "Failed to add reaction");
      
      // Refresh messages from server if optimistic update failed
      if (channelId) {
        await get().getMessages(channelId);
      }
    } finally {
      set({ isReacting: false });
    }
  },
  
  searchMessages: async (channelId, query, page = 1, limit = 20) => {
    
    
    if (!channelId) {
      
      toast.error("Channel ID is required to search messages");
      return;
    }
    
    if (!query || query.trim() === "") {
      
      set({ 
        searchResults: [],
        searchQuery: "",
        searchPagination: null
      });
      return;
    }
    
    set({ 
      isSearching: true,
      searchQuery: query
    });
    
    try {
      
      const response = await axiosInstance.get(`/messages/${channelId}/search`, {
        params: { query, page, limit }
      });
      
      
      // Check if the response has the expected structure
      if (response.data && response.data.data) {
        const { messages, pagination } = response.data.data;
        
        // Filter out messages that don't exist in current messages list
        const { messages: currentMessages } = get();
        const availableMessages = messages?.filter(searchMsg => 
          currentMessages.some(currentMsg => 
            currentMsg._id === searchMsg._id || currentMsg._id === searchMsg.messageId
          )
        ) || [];
        
        
        set({ 
          searchResults: availableMessages,
          searchPagination: pagination ? {
            ...pagination,
            total: availableMessages.length
          } : null
        });
      } else {
        
        set({ 
          searchResults: [],
          searchPagination: null
        });
        toast.error("Invalid search response from server");
      }
    } catch (error) {
      
      
      toast.error(error.response?.data?.message || "Failed to search messages");
      
      set({ 
        searchResults: [],
        searchPagination: null
      });
    } finally {
      set({ isSearching: false });
    }
  },
  
  // Add function to search direct messages
  searchDirectMessages: async (friendId, query, page = 1, limit = 20) => {
    
    
    if (!friendId) {
      
      toast.error("Friend ID is required to search direct messages");
      return;
    }
    
    if (!query || query.trim() === "") {
      
      set({ 
        directMessageSearchResults: [],
        directMessageSearchQuery: "",
        directMessageSearchPagination: null
      });
      return;
    }
    
    set({ 
      isSearching: true,
      directMessageSearchQuery: query
    });
    
    try {
      
      const response = await axiosInstance.get(`/direct-messages/search/${friendId}`, {
        params: { query, page, limit }
      });
      
      
      // Check if the response has the expected structure
      if (response.data && response.data.data) {
        const { messages, pagination } = response.data.data;
        
        // Filter out messages that don't exist in current direct messages list
        const { directMessages } = get();
        const availableMessages = messages?.filter(searchMsg => 
          directMessages.some(currentMsg => 
            currentMsg._id === searchMsg._id || currentMsg._id === searchMsg.messageId
          )
        ) || [];
        
        
        set({ 
          directMessageSearchResults: availableMessages,
          directMessageSearchPagination: pagination ? {
            ...pagination,
            total: availableMessages.length
          } : null
        });
      } else {
        
        set({ 
          directMessageSearchResults: [],
          directMessageSearchPagination: null
        });
        toast.error("Invalid search response from server");
      }
    } catch (error) {
      
      
      toast.error(error.response?.data?.message || "Failed to search direct messages");
      
      set({ 
        directMessageSearchResults: [],
        directMessageSearchPagination: null
      });
    } finally {
      set({ isSearching: false });
    }
  },
  
  clearSearch: () => {
    set({ 
      searchResults: [],
      searchQuery: "",
      searchPagination: null,
      directMessageSearchResults: [],
      directMessageSearchQuery: "",
      directMessageSearchPagination: null
    });
  },
  
  setSelectedFriend: (friend) => {
    set({ selectedFriend: friend });
  },
  
  // Add a direct message from socket or API
  addDirectMessage: (messageData) => {
    
    
    if (!messageData) {
      
      return;
    }
    
    // Get the current direct messages and auth info
    const { directMessages, selectedFriend } = get();
    const authUser = window.authUser || JSON.parse(localStorage.getItem('auth-store'))?.state?.authUser;
    
    if (!authUser) {
      
      return;
    }
    
    // Get the sender ID from the message
    const senderId = messageData.sender?.userId || messageData.senderId;
    const isFromCurrentUser = senderId === authUser._id;

    
    // Only add messages that are related to the current chat
    const isRelevantToCurrentChat = selectedFriend && (
      senderId === selectedFriend.friendId || // Message from selected friend
      (isFromCurrentUser && messageData.receiverId === selectedFriend.friendId) // Message from current user to selected friend
    );
    
    if (!isRelevantToCurrentChat && selectedFriend) {
      
      return;
    }
    
    // Create a standardized message object
    const newMessage = {
      _id: messageData.messageId || messageData._id || messageData.id || `temp-${Date.now()}`,
      content: messageData.message || messageData.content,
      image: messageData.image,
      sender: isFromCurrentUser ? {
        userId: authUser._id,
        username: authUser.username,
        avatar: authUser.avatar
      } : messageData.sender,
      senderId: senderId,
      receiverId: isFromCurrentUser ? messageData.receiverId || selectedFriend?.friendId : authUser._id,
      createdAt: messageData.timestamp || messageData.createdAt || new Date().toISOString(),
      updatedAt: messageData.updatedAt || new Date().toISOString(),
      isCode:false,
      language: messageData.language || "text",
      isSentByMe: isFromCurrentUser
    };
    
    // Check if the message already exists in the chat store
    const messageExists = directMessages.some(msg => 
      (msg._id && msg._id === newMessage._id) || 
      (msg.content === newMessage.content && 
       msg.senderId === newMessage.senderId && 
       Math.abs(new Date(msg.createdAt) - new Date(newMessage.createdAt)) < 1000)
    );
    
    if (messageExists) {
      
      return;
    }
    
    
    
    // Add the message to the store
    set({
      directMessages: [...directMessages, newMessage]
    });
  },
  
  // Remove a direct message from the store
  removeDirectMessage: (messageId) => {
    
    const { directMessages } = get();
    
    // Update the message to be marked as deleted instead of removing it
    const updatedMessages = directMessages.map(msg => {
      if (msg._id === messageId) {
        return {
          ...msg,
          isDeleted: true
        };
      }
      return msg;
    });
    
    set({
      directMessages: updatedMessages
    });
  },
  
  // Method to handle typing indicators
  setTypingIndicator: (data) => {
    const { senderId, isTyping } = data;
    
    set((state) => ({
      typingIndicators: {
        ...state.typingIndicators,
        [senderId]: isTyping ? Date.now() : null
      }
    }));
    
    // Clear typing indicator after a delay
    if (isTyping) {
      setTimeout(() => {
        set((state) => {
          const typingTime = state.typingIndicators[senderId];
          // Only clear if it hasn't been updated in the last 3 seconds
          if (typingTime && Date.now() - typingTime > 3000) {
            return {
              typingIndicators: {
                ...state.typingIndicators,
                [senderId]: null
              }
            };
          }
          return state;
        });
      }, 3500);
    }
  },
  
  // Method to update read status
  updateReadStatus: (data) => {
    const { directMessages } = get();
    
    // Update the read status of messages
    const updatedMessages = directMessages.map(message => {
      if (
        message.senderId === data.senderId && 
        message.receiverId === data.receiverId &&
        !message.readAt
      ) {
        return {
          ...message,
          readAt: data.readAt
        };
      }
      return message;
    });
    
    set({ directMessages: updatedMessages });
  },

  // Add a channel message received via socket
  addChannelMessage: (messageData) => {
    
    
    if (!messageData) {
      
      return;
    }
    
    // Get the current messages, auth info, and selected workspace
    const { messages, selectedChannel } = get();
    const authUser = window.authUser || 
                     JSON.parse(localStorage.getItem('auth-store'))?.state?.authUser || 
                     useAuthStore.getState().authUser;
    
    if (!authUser) {
      
      return;
    }
    
    // Check if message already exists in store to avoid duplicates
    const msgExists = messages.some(msg => 
      (msg._id && msg._id === messageData._id) || 
      (msg.content === messageData.content && 
       msg.sender?.userId === messageData.sender?.userId && 
       Math.abs(new Date(msg.createdAt) - new Date(messageData.createdAt || messageData.timestamp)) < 1000)
    );
    
    if (msgExists) {
      
      return;
    }
    
    // Get senderId - handle both object and string formats
    const senderId = messageData.senderId || messageData.sender?.userId;
    
    // Determine if message is from current user
    const isFromCurrentUser = messageData.isSentByMe !== undefined 
      ? messageData.isSentByMe 
      : (authUser && senderId === authUser._id);
    
    // Create a standardized message format that correctly handles sender information
    const newMessage = {
      _id: messageData._id || `socket-${Date.now()}`,
      content: messageData.content || messageData.message,
      image: messageData.image,
      userId: messageData.userId || senderId,
      senderId: senderId,
      sender: messageData.sender || {
        userId: senderId,
        username: messageData.senderName || (isFromCurrentUser ? authUser.username : 'Unknown User'),
        avatar: messageData.senderAvatar
      },
      channelId: messageData.channelId,
      workspaceId: messageData.workspaceId,
      createdAt: messageData.createdAt || messageData.timestamp || new Date().toISOString(),
      isSentByMe: isFromCurrentUser
    };
    
    
    
    // IMPORTANT: Only add messages that are for the currently selected channel
    // This prevents messages appearing in all channels
    const currentChannelId = selectedChannel?._id || selectedChannel?.channelId;
    
    if (newMessage.channelId === currentChannelId) {
      
      // Add to messages store for the current channel
      set({
        messages: [...messages, newMessage]
      });
    } else {
      
      // Don't add messages for other channels to the current view
    }
  },
  
  // Track channel typing indicators
  setChannelTypingIndicator: (data) => {
    if (!data || !data.channelId) return;
    
    const { userId, channelId, isTyping, username } = data;
    
    set((state) => {
      // Get current channel typing indicators
      const currentChannelTyping = state.channelTypingIndicators[channelId] || {};
      
      if (isTyping) {
        // Add or update user typing status
        return {
          channelTypingIndicators: {
            ...state.channelTypingIndicators,
            [channelId]: {
              ...currentChannelTyping,
              [userId]: {
                timestamp: Date.now(),
                username
              }
            }
          }
        };
      } else {
        // Remove user from typing
        const updatedChannelTyping = { ...currentChannelTyping };
        delete updatedChannelTyping[userId];
        
        return {
          channelTypingIndicators: {
            ...state.channelTypingIndicators,
            [channelId]: updatedChannelTyping
          }
        };
      }
    });
    
    // Clear typing indicator after timeout
    if (isTyping) {
      setTimeout(() => {
        set((state) => {
          const currentChannelTyping = state.channelTypingIndicators[channelId] || {};
          const userTyping = currentChannelTyping[userId];
          
          // Only clear if hasn't been updated recently
          if (userTyping && Date.now() - userTyping.timestamp > 3000) {
            const updatedChannelTyping = { ...currentChannelTyping };
            delete updatedChannelTyping[userId];
            
            return {
              channelTypingIndicators: {
                ...state.channelTypingIndicators,
                [channelId]: updatedChannelTyping
              }
            };
          }
          
          return state;
        });
      }, 3500);
    }
  },
  
  // Get typing users for a specific channel
  getChannelTypingUsers: (channelId) => {
    const { channelTypingIndicators } = get();
    const channelTyping = channelTypingIndicators[channelId] || {};
    
    return Object.entries(channelTyping)
      .map(([userId, data]) => ({
        userId,
        username: data.username
      }));
  },

  // Add, update or remove a reaction to/from a message
  updateMessageReactions: (messageId, reactions) => {
    
    const { messages, directMessages } = get();
    
    // First check if the message is in channel messages
    if (messages.some(msg => msg._id === messageId)) {
      
      set({
        messages: messages.map(msg => 
          msg._id === messageId ? { ...msg, reactions } : msg
        )
      });
    } 
    // Then check if it's in direct messages
    else if (directMessages.some(msg => msg._id === messageId)) {
      
      set({
        directMessages: directMessages.map(msg => 
          msg._id === messageId ? { ...msg, reactions } : msg
        )
      });
    } else {
      
    }
  },
  
  // Add a reaction to a message (client-side)
  addReaction: async (messageId, channelId, reaction) => {
    try {
      set({ isReacting: true });
      
      // Import the socket function
      const { addMessageReaction } = await import("../lib/socket");
      
      // Send via socket
      const socketSent = addMessageReaction(messageId, channelId, reaction);
      
      // If socket fails, fall back to API
      if (!socketSent) {
        await axiosInstance.post(`/messages/${messageId}/reaction`, { 
          reaction,
          channelId 
        });
      }
      
      // No need to update state here as the socket event will trigger updateMessageReactions
    } catch (error) {
      
      toast.error("Failed to add reaction");
    } finally {
      set({ isReacting: false });
    }
  },
  
  // Remove a message from state (used by socket handler)
  removeChannelMessage: (messageId) => {
    const { messages } = get();
    set({
      messages: messages.filter(msg => msg._id !== messageId)
    });
  },
}));