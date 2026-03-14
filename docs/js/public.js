import { getConfigWarning, getSupabase, hasSupabaseConfig } from "./supabase-client.js";
import { getCurrentProfile, loadStudentDashboardData, renderExpenses, renderIncomes, renderStudentFees, renderStudentSummary } from "./data.js";

async function main() {
    const warning = document.getElementById("config-warning");

    if (!hasSupabaseConfig()) {
        warning.textContent = getConfigWarning();
        warning.classList.remove("hidden");
        return;
    }

    const supabase = getSupabase();
    const switchAccountButton = document.getElementById("switch-account-button");
    const adminBackButton = document.getElementById("admin-back-button");

    // This button should work even if the dashboard data fails later.
    switchAccountButton.addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "./login.html";
    });

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
        warning.textContent = `No se pudo comprobar tu sesión: ${sessionError.message}`;
        warning.classList.remove("hidden");
        return;
    }

    if (!sessionData.session) {
        window.location.href = "./login.html";
        return;
    }

    const { user, profile } = await getCurrentProfile(supabase);

    if (!user) {
        window.location.href = "./login.html";
        return;
    }

    if (profile?.role === "tesorero") {
        adminBackButton.classList.remove("hidden");
        adminBackButton.addEventListener("click", () => {
            window.location.href = "./admin.html";
        });
    }

    const dashboard = await loadStudentDashboardData(supabase, user.email);
    renderStudentSummary(dashboard.student, dashboard.courseSummary);
    renderStudentFees(dashboard.student, "tabla-alumnos");
    renderExpenses(dashboard.expenses, "lista-gastos");
    renderIncomes(dashboard.incomes, "lista-ingresos");
}

main().catch((error) => {
    const warning = document.getElementById("config-warning");
    warning.textContent = `No se pudo cargar tu información: ${error.message}`;
    warning.classList.remove("hidden");
});
