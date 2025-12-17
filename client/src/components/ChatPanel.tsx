import { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount, useEnsName } from 'wagmi';
import { fetchMessages, sendMessage, subscribeToMessages } from '@/lib/supabaseClient';

interface Message {
  id: string;
  username: string;
  message: string;
  created_at: string;
}

interface ChatPanelProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ChatPanel({ isOpen: externalIsOpen, onOpenChange }: ChatPanelProps = {}) {
  const { address, isConnected } = useAccount();
  // Use wagmi's useEnsName hook for ENS lookup on Ethereum mainnet
  const { data: ensName } = useEnsName({
    address: address,
    chainId: 1, // Always query Ethereum mainnet for ENS
  });
  
  const [isOpen, setIsOpen] = useState(externalIsOpen ?? false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [username, setUsername] = useState('');
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);

  // Set username from ENS name, stored value, or wallet address
  useEffect(() => {
    const stored = localStorage.getItem('nola_chat_username');
    const isWalletFormat = stored && stored.includes('...') && stored.startsWith('0x');
    
    // Priority: 1. Custom username (not wallet format), 2. ENS name, 3. Shortened wallet address
    if (stored && !isWalletFormat) {
      setUsername(stored);
    } else if (ensName) {
      setUsername(ensName);
      localStorage.setItem('nola_chat_username', ensName);
    } else if (isConnected && address) {
      const walletUsername = `${address.slice(0, 6)}...${address.slice(-4)}`;
      setUsername(walletUsername);
      localStorage.setItem('nola_chat_username', walletUsername);
    }
  }, [isConnected, address, ensName]);

  useEffect(() => {
    if (externalIsOpen !== undefined) {
      setIsOpen(externalIsOpen);
    }
  }, [externalIsOpen]);
  
  const handleToggle = (newState: boolean) => {
    setIsOpen(newState);
    onOpenChange?.(newState);
  };
  
  useEffect(() => {
    if (isOpen && username) {
      loadMessages();

      // Real-time subscription for instant updates
      const unsubscribe = subscribeToMessages((payload) => {
        // Map payload to Message format
        const newMessage = {
          id: payload.id,
          username: payload.user,
          message: payload.text,
          created_at: payload.created_at
        };
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMessage.id)) return prev;
          return [...prev, newMessage];
        });
      });

      // Fast polling every 300ms (0.3s) - balanced for Supabase
      const pollInterval = setInterval(() => {
        loadMessages();
      }, 300);

      return () => {

      
    }
  }, [isOpe
      eEffect(() => {
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
        handleToggle(false);
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

  const handleChatButtonClick = () => {
    if (!isOpen && !username) {
      setShowUsernameModal(true);
    } else {
      handleToggle(!isOpen);
    }
  };

  const handleSetUsername = () => {
    const name = (document.getElementById('username-input') as HTMLInputElement)?.value.trim();
    if (name && name.length >= 4) {
      setUsername(name);
      localStorage.setItem('nola_chat_username', name);
      setShowUsernameModal(false);
      handleToggle(true);
    }
  };

  const filterMessage = (text: string): boolean => {
    // Block URLs
    const urlPattern = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(\w+\.\w{2,})/gi;
    if (urlPattern.test(text)) {
      // Assuming showToast is defined elsewhere and accessible
      // For demonstration purposes, we'll use console.error
      console.warn('Links are not allowed in chat'); 
      // showToast('Links are not allowed in chat', { type: 'warn' });
      return false;
    }

    // Block profanity and harsh words
    const profanityList = [
      'damn', 'hell', 'ass', 'bitch', 'fuck', 'shit', 'crap', 'bastard',
      'idiot', 'stupid', 'moron', 'dumb', 'loser', 'hate', 'kill', 'die'
    ];

    const lowerText = text.toLowerCase();
    for (const word of profanityList) {
      if (lowerText.includes(word)) {
        // Assuming showToast is defined elsewhere and accessible
        // For demonstration purposes, we'll use console.error
        console.warn('Please keep chat respectful and professional');
        // showToast('Please keep chat respectful and professional', { type: 'warn' });
        return false;
      }
    }

    return true;
  };


  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !username || isSending) return;

    if (!filterMessage(inputValue)) {
      return;
    }

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
        onClick={handleChatButtonClick}
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
          <button onClick={handleSend} disabled={isSending} data-testid="button-send-chat" className="chat-send-arrow">
            {isSending ? (
              <span className="btn-spinner" style={{ width: '14px', height: '14px' }} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {showUsernameModal && (
        <div className="username-modal" style={{ display: 'flex' }} data-testid="modal-username">
          <div className="modal-content">
            <h3 style={{ color: '#e0b3ff' }}>Choose a Username</h3>
            <input
              id="username-input"
              placeholder="Enter name (min 4 chars)"
              onKeyPress={(e) => {
                if (e.key === 'Enter') handleSetUsername();
              }}
              data-testid="input-username"
              minLength={4}
            />
            <button onClick={handleSetUsername} data-testid="button-confirm-username" className="themed-arrow-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function VieweEffect(arg0: () => void, arg1: Message[][]) {
          throw new Error('Function not implemented.');
      }
