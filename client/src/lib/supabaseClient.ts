
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Only create client if both credentials are valid URLs/keys
const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Credentials missing. Chat will not work.');
}

export const supabase = (supabaseUrl && supabaseAnonKey && isValidUrl(supabaseUrl))
  ? (() => {
      try {
        return createClient(supabaseUrl, supabaseAnonKey, {
          realtime: {
            params: {
              eventsPerSecond: 10,
            },
          },
        });
      } catch (e) {
        console.warn('[Supabase] Failed to initialize:', e);
        return null;
      }
    })()
  : null;

export async function fetchMessages() {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, user, text, created_at')
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.error('Fetch messages error:', error);
      return [];
    }

    // Map to expected format
    return (data || []).map(msg => ({
      id: msg.id,
      username: msg.user,
      message: msg.text,
      created_at: msg.created_at
    }));
  } catch (e) {
    console.error('fetchMessages exception:', e);
    return [];
  }
}

export async function sendMessage(username: string, message: string) {
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('chat_messages')
      .insert({ user: username, text: message });

    if (error) {
      console.error('Send message error:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('sendMessage exception:', e);
    return false;
  }
}

export function subscribeToMessages(callback: (message: any) => void) {
  if (!supabase) return null;

  const channel = supabase
    .channel('public:chat_messages')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      },
      (payload) => {
        callback(payload.new);
      }
    )
    .subscribe((status) => {
      console.log('Subscription status:', status);
    });

  return () => {
    channel.unsubscribe();
  };
}
