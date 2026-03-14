export const MONTHS = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre"
];

export const money = new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
});

function decorateStudent(student, fees, payments) {
    const paymentsByFee = new Map();
    for (const payment of payments) {
        const current = paymentsByFee.get(payment.fee_id) || 0;
        paymentsByFee.set(payment.fee_id, current + Number(payment.amount_paid));
    }

    const studentFees = fees.map((fee) => {
        const paid = Number(paymentsByFee.get(fee.id) || 0);
        const balance = Math.max(Number(fee.amount) - paid, 0);
        return {
            id: fee.id,
            month: fee.month,
            month_name: MONTHS[fee.month - 1],
            year: fee.year,
            amount: Number(fee.amount),
            paid,
            balance,
            status: balance <= 0 ? "Pagado" : "Pendiente"
        };
    });

    return {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        email: student.email,
        course: student.course,
        active: student.active,
        debt_total: studentFees.reduce((sum, fee) => sum + fee.balance, 0),
        total_paid: studentFees.reduce((sum, fee) => sum + fee.paid, 0),
        pending_count: studentFees.filter((fee) => fee.balance > 0).length,
        paid_months: studentFees
            .filter((fee) => fee.status === "Pagado")
            .map((fee) => `${fee.month_name} ${fee.year}`),
        fees: studentFees
    };
}

export async function loadAllTreasuryData(supabase) {
    const [studentsResult, feesResult, paymentsResult, expensesResult, incomesResult] = await Promise.all([
        supabase.from("students").select("*").order("last_name").order("first_name"),
        supabase.from("fees").select("*").order("year").order("month"),
        supabase.from("payments").select("*").order("paid_at", { ascending: false }),
        supabase.from("expenses").select("*").order("spent_at", { ascending: false }),
        supabase.from("income_entries").select("*").order("received_at", { ascending: false })
    ]);

    const errors = [studentsResult.error, feesResult.error, paymentsResult.error, expensesResult.error, incomesResult.error].filter(Boolean);
    if (errors.length) {
        throw new Error(errors[0].message);
    }

    const students = studentsResult.data || [];
    const fees = feesResult.data || [];
    const payments = paymentsResult.data || [];
    const expenses = (expensesResult.data || []).map((expense) => ({
        ...expense,
        amount: Number(expense.amount)
    }));
    const incomes = (incomesResult.data || []).map((income) => ({
        ...income,
        amount: Number(income.amount)
    }));

    const feesByStudent = new Map();
    for (const fee of fees) {
        const current = feesByStudent.get(fee.student_id) || [];
        current.push(fee);
        feesByStudent.set(fee.student_id, current);
    }

    const decoratedStudents = students.map((student) =>
        decorateStudent(
            student,
            feesByStudent.get(student.id) || [],
            payments.filter((payment) => (feesByStudent.get(student.id) || []).some((fee) => fee.id === payment.fee_id))
        )
    );

    const summary = {
        total_cuotas_pagadas: payments.reduce((sum, payment) => sum + Number(payment.amount_paid), 0),
        total_ingresos_adicionales: incomes.reduce((sum, income) => sum + income.amount, 0),
        total_gastos: expenses.reduce((sum, expense) => sum + expense.amount, 0),
        deuda_total: decoratedStudents.reduce((sum, student) => sum + student.debt_total, 0)
    };
    summary.total_ingresos = summary.total_cuotas_pagadas + summary.total_ingresos_adicionales;
    summary.saldo_actual = summary.total_ingresos - summary.total_gastos;

    return {
        students: decoratedStudents,
        expenses,
        incomes,
        summary
    };
}

export async function loadStudentDashboardData(supabase, email) {
    const { data: student, error: studentError } = await supabase
        .from("students")
        .select("*")
        .eq("email", email)
        .maybeSingle();

    if (studentError) {
        throw new Error(studentError.message);
    }

    if (!student) {
        throw new Error("Tu usuario no está vinculado a ningún alumno. Pide al tesorero que cargue tu correo.");
    }

    const { data: fees, error: feesError } = await supabase
        .from("fees")
        .select("*")
        .eq("student_id", student.id)
        .order("year")
        .order("month");

    if (feesError) {
        throw new Error(feesError.message);
    }

    const feeIds = (fees || []).map((fee) => fee.id);
    let payments = [];
    if (feeIds.length) {
        const { data: paymentsData, error: paymentsError } = await supabase
            .from("payments")
            .select("*")
            .in("fee_id", feeIds)
            .order("paid_at", { ascending: false });

        if (paymentsError) {
            throw new Error(paymentsError.message);
        }
        payments = paymentsData || [];
    }

    const [{ data: expensesData, error: expensesError }, { data: incomesData, error: incomesError }] = await Promise.all([
        supabase
            .from("expenses")
            .select("*")
            .order("spent_at", { ascending: false }),
        supabase
            .from("income_entries")
            .select("*")
            .order("received_at", { ascending: false })
    ]);

    if (expensesError) {
        throw new Error(expensesError.message);
    }
    if (incomesError) {
        throw new Error(incomesError.message);
    }

    const { data: financialSummary, error: financialSummaryError } = await supabase
        .rpc("get_course_financial_summary");

    if (financialSummaryError) {
        throw new Error(financialSummaryError.message);
    }

    const courseSummary = financialSummary?.[0] || {
        total_fee_payments: 0,
        total_extra_income: 0,
        total_income: 0,
        total_course_debt: 0,
        total_expenses: 0,
        current_balance: 0
    };

    return {
        student: decorateStudent(student, fees || [], payments),
        courseSummary,
        expenses: (expensesData || []).map((expense) => ({
            ...expense,
            amount: Number(expense.amount)
        })),
        incomes: (incomesData || []).map((income) => ({
            ...income,
            amount: Number(income.amount)
        }))
    };
}

export async function getCurrentProfile(supabase) {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
        throw new Error(userError.message);
    }

    if (!userData.user) {
        return { user: null, profile: null };
    }

    const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, email, display_name")
        .eq("id", userData.user.id)
        .maybeSingle();

    if (profileError) {
        throw new Error(profileError.message);
    }

    return {
        user: userData.user,
        profile
    };
}

export function renderAdminSummaryCards(containerId, summary) {
    document.getElementById(containerId).innerHTML = `
        <article><span>Cuotas pagadas</span><strong>${money.format(summary.total_cuotas_pagadas)}</strong></article>
        <article><span>Ingresos adicionales</span><strong>${money.format(summary.total_ingresos_adicionales)}</strong></article>
        <article><span>Ingresos totales</span><strong>${money.format(summary.total_ingresos)}</strong></article>
        <article><span>Gastos</span><strong>${money.format(summary.total_gastos)}</strong></article>
        <article><span>Saldo actual</span><strong>${money.format(summary.saldo_actual)}</strong></article>
        <article><span>Deuda pendiente</span><strong>${money.format(summary.deuda_total)}</strong></article>
    `;
}

export function renderStudentSummary(student, courseSummary = null) {
    document.getElementById("student-name").textContent = `${student.first_name} ${student.last_name}`;
    document.getElementById("student-course").textContent = student.course || "Curso sin especificar";
    document.getElementById("student-email").textContent = student.email || "Sin correo asignado";
    document.getElementById("student-resumen").innerHTML = `
        <article><span>Deuda curso</span><strong>${money.format(courseSummary?.total_course_debt || 0)}</strong></article>
        <article><span>Deuda alumno</span><strong>${money.format(student.debt_total)}</strong></article>
        <article><span>Pagado alumno</span><strong>${money.format(student.total_paid)}</strong></article>
        <article><span>Pagado curso</span><strong>${money.format(courseSummary?.total_fee_payments || 0)}</strong></article>
        <article><span>Fondos curso</span><strong>${money.format(courseSummary?.total_income || 0)}</strong></article>
        <article><span>Gastos curso</span><strong>${money.format(courseSummary?.total_expenses || 0)}</strong></article>
    `;
}

export function renderStudents(students, containerId, showActions = false) {
    const container = document.getElementById(containerId);
    if (!students.length) {
        container.innerHTML = '<div class="empty-state">Todavía no hay alumnos cargados.</div>';
        return;
    }

    if (showActions) {
        container.innerHTML = students.map((student) => `
            <details class="student-accordion">
                <summary class="student-summary-row">
                    <div>
                        <h3>${student.first_name} ${student.last_name}</h3>
                        <p>${student.course || "Curso sin especificar"}</p>
                    </div>
                    <div class="student-summary-side">
                        <strong>Debe ${money.format(student.debt_total)}</strong>
                        <span class="chip ${student.pending_count ? "pending" : ""}">${student.pending_count ? `${student.pending_count} cuotas pendientes` : "Sin cuotas pendientes"}</span>
                    </div>
                </summary>
                <div class="student-accordion-body">
                    <div class="student-top">
                        <div>
                            <p>${student.email || "Sin correo asignado"}</p>
                        </div>
                        <div>
                            <strong>Total pagado ${money.format(student.total_paid)}</strong>
                        </div>
                    </div>
                    <div class="chip-row">
                        ${(student.paid_months.length ? student.paid_months : ["Sin meses pagados"]).map((label) => `
                            <span class="chip">${label}</span>
                        `).join("")}
                    </div>
                    <div class="fee-grid">
                        ${student.fees.map((fee) => `
                            <div class="fee">
                                <strong>${fee.month_name} ${fee.year}</strong>
                                <span>Cuota: ${money.format(fee.amount)}</span><br>
                                <span>Pagado: ${money.format(fee.paid)}</span><br>
                                <span class="chip ${fee.status === "Pendiente" ? "pending" : ""}">${fee.status}</span>
                            </div>
                        `).join("")}
                    </div>
                </div>
            </details>
        `).join("");
        return;
    }

    container.innerHTML = students.map((student) => `
        <article class="student-card">
            <div class="student-top">
                <div>
                    <h3>${student.first_name} ${student.last_name}</h3>
                    <p>${student.course || "Curso sin especificar"}</p>
                    <p>${student.email || "Sin correo asignado"}</p>
                </div>
                <div>
                    <strong>Debe ${money.format(student.debt_total)}</strong>
                </div>
            </div>
            <div class="chip-row">
                ${(student.paid_months.length ? student.paid_months : ["Sin meses pagados"]).map((label) => `
                    <span class="chip">${label}</span>
                `).join("")}
            </div>
            <div class="fee-grid">
                ${student.fees.map((fee) => `
                    <div class="fee">
                        <strong>${fee.month_name} ${fee.year}</strong>
                        <span>Cuota: ${money.format(fee.amount)}</span><br>
                        <span>Pagado: ${money.format(fee.paid)}</span><br>
                        <span class="chip ${fee.status === "Pendiente" ? "pending" : ""}">${fee.status}</span>
                    </div>
                `).join("")}
            </div>
        </article>
    `).join("");
}

export function renderStudentFees(student, containerId) {
    renderStudents([student], containerId, false);
}

export function renderExpenses(expenses, containerId, showActions = false) {
    const container = document.getElementById(containerId);
    if (!expenses.length) {
        container.innerHTML = '<div class="empty-state">No hay gastos registrados.</div>';
        return;
    }

    container.innerHTML = expenses.map((expense) => `
        <article class="expense-card">
            <div class="student-top">
                <div>
                    <h3>${expense.concept}</h3>
                    <p>${expense.description || "Sin descripción"}</p>
                </div>
                <div>
                    <strong>${money.format(expense.amount)}</strong>
                    <p>${expense.spent_at}</p>
                </div>
            </div>
            ${showActions ? `
                <div class="row-actions">
                    <button class="small-button secondary" type="button" data-edit-expense="${expense.id}">Editar gasto</button>
                </div>
            ` : ""}
        </article>
    `).join("");
}

export function renderIncomes(incomes, containerId, showActions = false) {
    const container = document.getElementById(containerId);
    if (!incomes.length) {
        container.innerHTML = '<div class="empty-state">No hay ingresos adicionales registrados.</div>';
        return;
    }

    container.innerHTML = incomes.map((income) => `
        <article class="income-card">
            <div class="student-top">
                <div>
                    <h3>${income.source}</h3>
                    <p>${income.description || "Sin detalle"}</p>
                </div>
                <div>
                    <strong>${money.format(income.amount)}</strong>
                    <p>${income.received_at}</p>
                </div>
            </div>
            ${showActions ? `
                <div class="row-actions">
                    <button class="small-button secondary" type="button" data-edit-income="${income.id}">Editar ingreso</button>
                </div>
            ` : ""}
        </article>
    `).join("");
}

