import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Chat will not work.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export async function fetchMessages() {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, username, message, created_at')
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      console.error('Fetch messages error:', error);
      return [];
    }

    return data || [];
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
      .insert({ username, message });

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

  const subscription = supabase
    .channel('chat_messages_channel')
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
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}