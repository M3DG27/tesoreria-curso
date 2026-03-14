import { getConfigWarning, getSupabase, hasSupabaseConfig } from "./supabase-client.js";
import { getCurrentProfile } from "./data.js";

const warning = document.getElementById("config-warning");
const form = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const passwordInput = document.getElementById("password-input");
const togglePasswordButton = document.getElementById("toggle-password-button");

function hideLoginError() {
    loginError.classList.add("hidden");
}

function showLoginError(message = "Reintenta con otra contraseña.") {
    loginError.textContent = message;
    loginError.classList.remove("hidden");
}

async function redirectByRole(supabase) {
    const { user, profile } = await getCurrentProfile(supabase);
    if (!user) {
        return;
    }

    if (profile?.role === "tesorero") {
        window.location.href = "./admin.html";
        return;
    }

    window.location.href = "./index.html";
}

if (!hasSupabaseConfig()) {
    warning.textContent = getConfigWarning();
    warning.classList.remove("hidden");
} else {
    const supabase = getSupabase();

    togglePasswordButton.addEventListener("click", () => {
        const showingPassword = passwordInput.type === "text";
        passwordInput.type = showingPassword ? "password" : "text";
        togglePasswordButton.textContent = showingPassword ? "Ver" : "Ocultar";
    });

    redirectByRole(supabase).catch(() => {});

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideLoginError();

        const formData = new FormData(form);
        const { error } = await supabase.auth.signInWithPassword({
            email: String(formData.get("email") || "").trim(),
            password: String(formData.get("password") || "")
        });

        if (error) {
            showLoginError();
            return;
        }

        await redirectByRole(supabase);
    });
}
