import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY, CONFIGURED } from '../config.js';
export const configured = CONFIGURED;
export const supabase = CONFIGURED ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}) : null;
export function requireClient(){if(!supabase) throw new Error('Setup is not complete. Ask your administrator to configure the application.'); return supabase;}
