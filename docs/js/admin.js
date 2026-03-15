import { MONTHS, getCurrentProfile, loadAllTreasuryData, money, renderAdminSummaryCards, renderExpenses, renderIncomes, renderStudents } from "./data.js";
import { getConfigWarning, getSupabase, hasSupabaseConfig } from "./supabase-client.js";

const warning = document.getElementById("config-warning");
const alumnoForm = document.getElementById("alumno-form");
const cuotasForm = document.getElementById("cuotas-form");
const pagosForm = document.getElementById("pagos-form");
const ingresosForm = document.getElementById("ingresos-form");
const gastosForm = document.getElementById("gastos-form");
const cuotaSearch = document.getElementById("cuota-search");
const adminExpenses = document.getElementById("admin-gastos");
const adminIncomes = document.getElementById("admin-ingresos");
const cancelExpenseButton = document.getElementById("cancel-expense-edit");
const cancelIncomeButton = document.getElementById("cancel-income-edit");

let supabase;
let currentStudents = [];
let currentExpenses = [];
let currentIncomes = [];
let pendingFees = [];

function bindStudentAccordions() {
    document.querySelectorAll(".student-accordion").forEach((accordion) => {
        const summary = accordion.querySelector(".student-summary-row");
        const body = accordion.querySelector(".student-accordion-body");

        if (!summary || !body) {
            return;
        }

        body.style.maxHeight = accordion.open ? `${body.scrollHeight}px` : "0px";

        summary.addEventListener("click", (event) => {
            event.preventDefault();

            if (accordion.dataset.animating === "true") {
                return;
            }

            accordion.dataset.animating = "true";

            if (accordion.open) {
                body.style.maxHeight = `${body.scrollHeight}px`;

                requestAnimationFrame(() => {
                    body.style.maxHeight = "0px";
                    accordion.classList.add("is-collapsing");
                });

                const onCloseEnd = (closeEvent) => {
                    if (closeEvent.propertyName !== "max-height") {
                        return;
                    }

                    accordion.open = false;
                    accordion.classList.remove("is-collapsing");
                    accordion.dataset.animating = "false";
                    body.removeEventListener("transitionend", onCloseEnd);
                };

                body.addEventListener("transitionend", onCloseEnd);
                return;
            }

            accordion.open = true;
            accordion.classList.add("is-expanding");
            body.style.maxHeight = "0px";

            requestAnimationFrame(() => {
                body.style.maxHeight = `${body.scrollHeight}px`;
            });

            const onOpenEnd = (openEvent) => {
                if (openEvent.propertyName !== "max-height") {
                    return;
                }

                accordion.classList.remove("is-expanding");
                accordion.dataset.animating = "false";
                body.removeEventListener("transitionend", onOpenEnd);
            };

            body.addEventListener("transitionend", onOpenEnd);
        });
    });
}

function showWarning(message) {
    warning.textContent = message;
    warning.classList.remove("hidden");
}

function hideWarning() {
    warning.classList.add("hidden");
}

function resetStudentForm() {
    alumnoForm.reset();
    alumnoForm.elements["activo"].value = "1";
}

function resetExpenseForm() {
    gastosForm.reset();
    gastosForm.elements["id"].value = "";
    gastosForm.querySelector('button[type="submit"]').textContent = "Guardar gasto";
}

function resetIncomeForm() {
    ingresosForm.reset();
    ingresosForm.elements["id"].value = "";
    ingresosForm.querySelector('button[type="submit"]').textContent = "Guardar ingreso";
}

function feeLabel(fee) {
    return `${fee.student_name} | ${MONTHS[fee.month - 1]} ${fee.year} | saldo ${money.format(fee.balance)}`;
}

function fillFeeOptions(items) {
    const select = document.getElementById("cuota-select");
    if (!items.length) {
        select.innerHTML = '<option value="">No hay cuotas pendientes</option>';
        return;
    }

    select.innerHTML = ['<option value="">Selecciona una cuota</option>']
        .concat(items.map((item) => `<option value="${item.id}">${feeLabel(item)}</option>`))
        .join("");
}

function startExpenseEdit(expense) {
    gastosForm.elements["id"].value = expense.id;
    gastosForm.elements["concepto"].value = expense.concept;
    gastosForm.elements["monto"].value = expense.amount;
    gastosForm.elements["fecha"].value = expense.spent_at;
    gastosForm.elements["descripcion"].value = expense.description || "";
    gastosForm.querySelector('button[type="submit"]').textContent = "Guardar cambios";
    gastosForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function startIncomeEdit(income) {
    ingresosForm.elements["id"].value = income.id;
    ingresosForm.elements["origen"].value = income.source;
    ingresosForm.elements["monto"].value = income.amount;
    ingresosForm.elements["fecha"].value = income.received_at;
    ingresosForm.elements["descripcion"].value = income.description || "";
    ingresosForm.querySelector('button[type="submit"]').textContent = "Guardar cambios";
    ingresosForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function ensureTreasurer() {
    const { user, profile } = await getCurrentProfile(supabase);
    if (!user || profile?.role !== "tesorero") {
        await supabase.auth.signOut();
        window.location.href = "./login.html";
        return false;
    }

    return true;
}

async function refreshData() {
    const treasuryData = await loadAllTreasuryData(supabase);
    currentStudents = treasuryData.students;
    currentExpenses = treasuryData.expenses;
    currentIncomes = treasuryData.incomes;
    pendingFees = treasuryData.students.flatMap((student) =>
        student.fees
            .filter((fee) => fee.balance > 0)
            .map((fee) => ({
                id: fee.id,
                month: fee.month,
                year: fee.year,
                balance: fee.balance,
                student_name: `${student.first_name} ${student.last_name}`
            }))
    );

    renderAdminSummaryCards("admin-resumen", treasuryData.summary);
    renderStudents(treasuryData.students, "admin-alumnos", true);
    renderIncomes(treasuryData.incomes, "admin-ingresos", true);
    renderExpenses(treasuryData.expenses, "admin-gastos", true);
    bindStudentAccordions();
    fillFeeOptions(pendingFees);
}

async function createFeesForStudents(studentIds, year, amount, monthStart, monthEnd) {
    const { data: existingFees, error: existingError } = await supabase
        .from("fees")
        .select("student_id, month, year")
        .in("student_id", studentIds)
        .eq("year", year)
        .gte("month", monthStart)
        .lte("month", monthEnd);

    if (existingError) {
        throw existingError;
    }

    const existing = new Set((existingFees || []).map((fee) => `${fee.student_id}-${fee.month}-${fee.year}`));
    const rows = [];

    for (const studentId of studentIds) {
        for (let month = monthStart; month <= monthEnd; month += 1) {
            const key = `${studentId}-${month}-${year}`;
            if (!existing.has(key)) {
                rows.push({ student_id: studentId, month, year, amount });
            }
        }
    }

    if (!rows.length) {
        return;
    }

    const { error } = await supabase.from("fees").insert(rows);
    if (error) {
        throw error;
    }
}

async function main() {
    if (!hasSupabaseConfig()) {
        showWarning(getConfigWarning());
        return;
    }

    supabase = getSupabase();

    const isTreasurer = await ensureTreasurer();
    if (!isTreasurer) {
        return;
    }

    await refreshData();

    alumnoForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideWarning();

        const payload = {
            first_name: alumnoForm.elements["nombre"].value.trim(),
            last_name: alumnoForm.elements["apellido"].value.trim(),
            email: alumnoForm.elements["email"].value.trim().toLowerCase(),
            course: alumnoForm.elements["curso"].value.trim(),
            active: alumnoForm.elements["activo"].value === "1"
        };

        if (!payload.first_name || !payload.last_name || !payload.email) {
            showWarning("Nombre, apellido y correo son obligatorios.");
            return;
        }

        const { error } = await supabase.from("students").insert(payload);

        if (error) {
            showWarning(error.message);
            return;
        }

        resetStudentForm();
        await refreshData();
    });

    cuotasForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideWarning();

        const year = Number(cuotasForm.elements["anio"].value);
        const amount = Number(cuotasForm.elements["monto"].value);
        const monthStart = Number(cuotasForm.elements["mes_inicio"].value);
        const monthEnd = Number(cuotasForm.elements["mes_fin"].value);

        if (!amount || monthStart > monthEnd) {
            showWarning("Revisa el monto y el rango de meses.");
            return;
        }

        const activeIds = currentStudents.filter((student) => student.active).map((student) => student.id);
        if (!activeIds.length) {
            showWarning("No hay alumnos activos para generar cuotas.");
            return;
        }

        try {
            await createFeesForStudents(activeIds, year, amount, monthStart, monthEnd);
            await refreshData();
        } catch (error) {
            showWarning(error.message);
        }
    });

    pagosForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideWarning();

        const payload = {
            fee_id: Number(pagosForm.elements["cuota_id"].value),
            amount_paid: Number(pagosForm.elements["monto_pagado"].value),
            paid_at: pagosForm.elements["fecha_pago"].value,
            payment_method: pagosForm.elements["metodo_pago"].value.trim(),
            note: pagosForm.elements["observacion"].value.trim()
        };

        if (!payload.fee_id || !payload.amount_paid || !payload.paid_at) {
            showWarning("Completa los datos del pago.");
            return;
        }

        const { error } = await supabase.from("payments").insert(payload);
        if (error) {
            showWarning(error.message);
            return;
        }

        pagosForm.reset();
        await refreshData();
    });

    gastosForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideWarning();

        const id = gastosForm.elements["id"].value;
        const payload = {
            concept: gastosForm.elements["concepto"].value.trim(),
            amount: Number(gastosForm.elements["monto"].value),
            spent_at: gastosForm.elements["fecha"].value,
            description: gastosForm.elements["descripcion"].value.trim()
        };

        if (!payload.concept || !payload.amount || !payload.spent_at) {
            showWarning("Completa los datos del gasto.");
            return;
        }

        let error;
        if (id) {
            ({ error } = await supabase.from("expenses").update(payload).eq("id", Number(id)));
        } else {
            ({ error } = await supabase.from("expenses").insert(payload));
        }

        if (error) {
            showWarning(error.message);
            return;
        }

        resetExpenseForm();
        await refreshData();
    });

    ingresosForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        hideWarning();

        const id = ingresosForm.elements["id"].value;
        const payload = {
            source: ingresosForm.elements["origen"].value.trim(),
            amount: Number(ingresosForm.elements["monto"].value),
            received_at: ingresosForm.elements["fecha"].value,
            description: ingresosForm.elements["descripcion"].value.trim()
        };

        if (!payload.source || !payload.amount || !payload.received_at) {
            showWarning("Completa los datos del ingreso.");
            return;
        }

        let error;
        if (id) {
            ({ error } = await supabase.from("income_entries").update(payload).eq("id", Number(id)));
        } else {
            ({ error } = await supabase.from("income_entries").insert(payload));
        }

        if (error) {
            showWarning(error.message);
            return;
        }

        resetIncomeForm();
        await refreshData();
    });

    cuotaSearch.addEventListener("input", () => {
        const term = cuotaSearch.value.toLowerCase().trim();
        fillFeeOptions(pendingFees.filter((fee) => feeLabel(fee).toLowerCase().includes(term)));
    });

    adminExpenses.addEventListener("click", (event) => {
        const button = event.target.closest("[data-edit-expense]");
        if (!button) {
            return;
        }

        const expense = currentExpenses.find((item) => item.id === Number(button.dataset.editExpense));
        if (!expense) {
            showWarning("No se pudo encontrar el gasto seleccionado.");
            return;
        }

        hideWarning();
        startExpenseEdit(expense);
    });

    adminIncomes.addEventListener("click", (event) => {
        const button = event.target.closest("[data-edit-income]");
        if (!button) {
            return;
        }

        const income = currentIncomes.find((item) => item.id === Number(button.dataset.editIncome));
        if (!income) {
            showWarning("No se pudo encontrar el ingreso seleccionado.");
            return;
        }

        hideWarning();
        startIncomeEdit(income);
    });

    cancelExpenseButton.addEventListener("click", resetExpenseForm);
    cancelIncomeButton.addEventListener("click", resetIncomeForm);
    document.getElementById("logout-button").addEventListener("click", async () => {
        await supabase.auth.signOut();
        window.location.href = "./login.html";
    });
}

main().catch((error) => {
    showWarning(`No se pudo cargar el panel: ${error.message}`);
});

