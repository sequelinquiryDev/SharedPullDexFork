import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchMessages, sendMessage, subscribeToMessages } from '@/lib/supabaseClient';

interface Message {
  id: string;
  username: string;
  message: string;
  created_at: string;
}

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [username, setUsername] = useState('');
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem('nola_chat_username');
    if (stored) {
      setUsername(stored);
    }
  }, []);

  useEffect(() => {
    if (isOpen && username) {
      loadMessages();
      
      // Real-time subscription for instant updates
      const unsubscribe = subscribeToMessages((newMessage) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMessage.id)) return prev;
          return [...prev, newMessage];
        });
      });

      // Fallback polling every 350ms for reliability
      const pollInterval = setInterval(() => {
        loadMessages();
      }, 350);

      return () => {
        if (unsubscribe) unsubscribe();
        clearInterval(pollInterval);
      };
    }
  }, [isOpen, username]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        sidebarRef.current &&
        toggleRef.current &&
        !sidebarRef.current.contains(e.target as Node) &&
        !toggleRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const loadMessages = async () => {
    const msgs = await fetchMessages();
    setMessages(msgs);
  };

  const handleToggle = () => {
    if (!isOpen && !username) {
      setShowUsernameModal(true);
    } else {
      setIsOpen(!isOpen);
    }
  };

  const handleSetUsername = () => {
    const name = (document.getElementById('username-input') as HTMLInputElement)?.value.trim();
    if (name) {
      setUsername(name);
      localStorage.setItem('nola_chat_username', name);
      setShowUsernameModal(false);
      setIsOpen(true);
    }
  };

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !username || isSending) return;

    const messageText = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    const success = await sendMessage(username, messageText);
    if (!success) {
      setInputValue(messageText);
    }

    setIsSending(false);
  }, [inputValue, username, isSending]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <div
        ref={toggleRef}
        className="chat-toggle"
        onClick={handleToggle}
        data-testid="button-chat-toggle"
      >
        Public Chat 🔘
      </div>

      <div
        ref={sidebarRef}
        className={`chat-sidebar ${isOpen ? 'open' : ''}`}
        data-testid="panel-chat-sidebar"
      >
        <h3 style={{ textAlign: 'center', marginBottom: '10px', color: '#e0b3ff' }}>
          Chat
        </h3>

        <div
          style={{
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
          data-testid="container-chat-messages"
        >
          {messages.map((msg) => (
            <div key={msg.id} className="chat-msg" data-testid={`chat-msg-${msg.id}`}>
              <div style={{ fontWeight: 700, fontSize: '12px', color: '#b445ff', marginBottom: '4px' }}>
                {msg.username}
              </div>
              <div>{msg.message}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input">
          <input
            type="text"
            placeholder="Drop your alpha..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            data-testid="input-chat-message"
          />
          <button onClick={handleSend} disabled={isSending} data-testid="button-send-chat">
            {isSending ? '...' : 'NOLA'}
          </button>
        </div>
      </div>

      {showUsernameModal && (
        <div className="username-modal" style={{ display: 'flex' }} data-testid="modal-username">
          <div className="modal-content">
            <h3 style={{ color: '#e0b3ff' }}>Choose a Username</h3>
            <input
              id="username-input"
              placeholder="Enter name"
              onKeyPress={(e) => {
                if (e.key === 'Enter') handleSetUsername();
              }}
              data-testid="input-username"
            />
            <button onClick={handleSetUsername} data-testid="button-confirm-username">
              Say NOLA
            </button>
          </div>
        </div>
      )}
    </>
  );
}