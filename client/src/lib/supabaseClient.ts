import { config } from './config';

interface Message {
  id: string;
  username: string;
  message: string;
  created_at: string;
}

let supabaseClient: any = null;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.warn('Supabase not configured');
    return null;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);
    return supabaseClient;
  } catch (e) {
    console.warn('Failed to load Supabase', e);
    return null;
  }
}

export async function fetchMessages(): Promise<Message[]> {
  const supabase = await getSupabase();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('nola_chat')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      console.error('Error fetching messages:', error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('Failed to fetch messages:', e);
    return [];
  }
}

export async function sendMessage(username: string, message: string): Promise<boolean> {
  const supabase = await getSupabase();
  if (!supabase) return false;

  try {
    const { error } = await supabase.from('nola_chat').insert([{ username, message }]);
    if (error) {
      console.error('Error sending message:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Failed to send message:', e);
    return false;
  }
}

export function subscribeToMessages(
  callback: (message: Message) => void
): (() => void) | null {
  let cleanup: (() => void) | null = null;

  getSupabase().then((supabase) => {
    if (!supabase) return;

    const channel = supabase
      .channel('nola_chat_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'nola_chat' },
        (payload: any) => {
          if (payload.new) {
            callback(payload.new as Message);
          }
        }
      )
      .subscribe();

    cleanup = () => {
      supabase.removeChannel(channel);
    };
  });

  return () => {
    if (cleanup) cleanup();
  };
}
