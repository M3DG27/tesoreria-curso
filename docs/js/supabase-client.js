const config = window.APP_CONFIG || {};

export function hasSupabaseConfig() {
    return Boolean(
        config.SUPABASE_URL &&
        config.SUPABASE_ANON_KEY &&
        !config.SUPABASE_URL.startsWith("REEMPLAZA_") &&
        !config.SUPABASE_ANON_KEY.startsWith("REEMPLAZA_")
    );
}

export function getConfigWarning() {
    return "Falta configurar Supabase. Edita docs/config.js con tu SUPABASE_URL y tu SUPABASE_ANON_KEY antes de publicar.";
}

export function getSupabase() {
    if (!hasSupabaseConfig()) {
        return null;
    }

    return window.supabase.createClient(
        config.SUPABASE_URL,
        config.SUPABASE_ANON_KEY,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true
            }
        }
    );
}
