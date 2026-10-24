/* Public browser configuration only. Replace these placeholders during deployment.
 * The anon/publishable key is intended for browser use; RLS must protect every table.
 * NEVER put a service-role key, database password, or other privileged secret here.
 */
export const SUPABASE_URL = 'https://nvjbsacfpotyrbrzkbom.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_8eTnfHWl8HlIlp72O-sFPQ_qXTwVjnX';
export const COMPANY = Object.freeze({
  name: 'Avenix Overseas',
  tagline: 'Beyond Borders, We Build Pathways to Your Better Future.',
  address: 'Delhi, India',
  website: 'https://avenixoverseas.com',
  emails: ['contact@avenixoverseas.com', 'info@avenixoverseas.com'],
  mobile: '+91 8006355135',
  gstin: '',
  developer: 'Developed by Mohammad Affan Siddiqui'
});
export const CONFIGURED = !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_ANON_KEY.includes('YOUR_PUBLIC');
export const GST_RATE = 0.18;
