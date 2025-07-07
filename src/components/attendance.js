
import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Calendar, User, Plus, Save, Trash2 } from 'lucide-react';

const timeToMinutes = (timeStr) => {
    if (!timeStr || timeStr.trim() === '' || timeStr.toUpperCase() === 'H') return NaN;
    const parts = timeStr.split(':');
    if (parts.length !== 2) return NaN;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
    return hours * 60 + minutes;
};

// Standard times for OVERTIME calculation
const STANDARD_START_MINUTES = timeToMinutes('09:00');
const STANDARD_END_MINUTES = timeToMinutes('17:30'); // 5:30 PM
const STANDARD_WORK_MINUTES = STANDARD_END_MINUTES - STANDARD_START_MINUTES; // 8.5 hours = 510 minutes

// Standard minutes for LESS HOURS calculation (8 hours)
const EIGHT_HOUR_WORK_MINUTES = 8 * 60; // 480 minutes

const calculateWorkDetails = (inTimeStr, outTimeStr, dateStr) => {
    const dayDate = new Date(dateStr + 'T00:00:00Z');
    const isSunday = dayDate.getUTCDay() === 0;

    // If marked as holiday ('H'), no overtime or less hours
    if (inTimeStr.toUpperCase() === 'H' || outTimeStr.toUpperCase() === 'H') {
        return { overTime: 0, lessHours: 0 };
    }

    const inMinutes = timeToMinutes(inTimeStr);
    const outMinutes = timeToMinutes(outTimeStr);

    // If times are invalid, no overtime or less hours
    if (isNaN(inMinutes) || isNaN(outMinutes)) {
        return { overTime: 0, lessHours: 0 };
    }

    let otHours = 0;
    let lessHours = 0;
    const workedMinutes = outMinutes - inMinutes;

    // Handle negative workedMinutes (e.g., clocking out before clocking in, or overnight shift not fully handled)
    if (workedMinutes < 0) {
        // For simplicity, we'll treat negative worked minutes as 0, or you might want to flag an error
        return { overTime: 0, lessHours: 0 };
    }

    // On Sundays, all worked minutes are considered overtime
    if (isSunday) {
        if (workedMinutes > 0) {
            otHours = workedMinutes / 60;
        }
    } else {
        // For weekdays:

        // Calculate Less Hours based on an 8-hour day
        if (workedMinutes < EIGHT_HOUR_WORK_MINUTES) {
            lessHours = (EIGHT_HOUR_WORK_MINUTES - workedMinutes) / 60;
        }

        // Calculate Overtime based on the 8.5-hour standard workday (09:00 to 17:30)
        // Overtime for hours worked before 9:00 AM
        if (inMinutes < STANDARD_START_MINUTES) {
            otHours += (STANDARD_START_MINUTES - inMinutes) / 60;
        }
        // Overtime for hours worked after 5:30 PM
        if (outMinutes > STANDARD_END_MINUTES) {
            otHours += (outMinutes - STANDARD_END_MINUTES) / 60;
        }

        // IMPORTANT CORRECTION: Overtime if total worked hours exceed standard 8.5 hours within the window
        // This accounts for cases like 8:30-17:30 (9 hours) where 0.5 hours are still overtime,
        // or 09:00-18:00 (9 hours) where 0.5 hours are also already accounted for above.
        // We need to ensure we don't double count if the "before/after" rules cover it.
        // The most robust way is to cap the regular hours.
        const regularHoursWorked = Math.min(Math.max(0, outMinutes - Math.max(inMinutes, STANDARD_START_MINUTES)), STANDARD_WORK_MINUTES);
        const totalOTFromDuration = (workedMinutes - regularHoursWorked) / 60;

        // Add to otHours only if it's new overtime not covered by early start/late end already
        // This logic is tricky. Let's simplify:
        // Overtime is total minutes worked MINUS 8.5 hours, PLUS any time outside the standard window.
        // A simpler approach for the specified rules:
        // 1. Any time before 9:00 AM is OT.
        // 2. Any time after 5:30 PM is OT.
        // 3. If the *actual time worked between in and out* exceeds 8.5 hours, the excess is OT.
        // The current `otHours` handles 1 and 2. Let's add 3 carefully.

        const totalScheduledWorkedMinutes = Math.min(STANDARD_END_MINUTES, outMinutes) - Math.max(STANDARD_START_MINUTES, inMinutes);
        if (totalScheduledWorkedMinutes > STANDARD_WORK_MINUTES) {
            // This case handles working extra hours *within* or crossing the window
            // If in at 9:00 and out at 18:00, the 'outMinutes > STANDARD_END_MINUTES' already adds 30 mins OT.
            // If in at 8:30 and out at 17:30, the 'inMinutes < STANDARD_START_MINUTES' already adds 30 mins OT.
            // The challenge is if someone worked, say, 09:00 to 18:00, but their standard was only 8 hours, and they are paid OT over 8.5 hours.
            // Given the rule "9:00 to 5:30 only" as the "constraint for overtime", it implies:
            // - If you work 08:00 to 17:30 (9.5 hrs), 08:00-09:00 (1hr) is OT. Remaining 8.5 hrs are standard.
            // - If you work 09:00 to 18:30 (9.5 hrs), 17:30-18:30 (1hr) is OT. Remaining 8.5 hrs are standard.
            // - If you work 08:00 to 18:30 (10.5 hrs), 08:00-09:00 (1hr) is OT, 17:30-18:30 (1hr) is OT. Total 2 hours OT. Remaining 8.5 hrs are standard.

            // The issue is if the *total worked duration* exceeds 8.5 hours *and* it falls within the standard window.
            // Example: If standard day is 8 hours, and I work 9 hours *within* 9:00-17:30, where does the 1 hour OT come from?
            // Your rule "9:00 to 5:30 only" means the *regular* hours are from 9:00 to 5:30 (8.5 hours).
            // So, any work *beyond* these 8.5 hours of *actual presence* should be OT.

            // Let's re-think based on the most direct interpretation of "9:00 to 5:30 only" for overtime.
            // It suggests that the **scheduled 8.5 hours are not overtime**, and anything outside is.
            // However, your consistent feedback suggests that if the *total duration worked* is, for example, 9 hours,
            // and the standard is 8.5 hours, then 0.5 hours should be OT, even if it's within the standard window.

            // NEW LOGIC FOR WEEKDAY OVERTIME (Revised based on "total worked hours > 8.5 hours")
            // This is the most common way companies calculate overtime beyond a threshold.
            const standardWorkdayDurationMinutes = STANDARD_WORK_MINUTES; // 8.5 hours
            if (workedMinutes > standardWorkdayDurationMinutes) {
                // Add the excess over 8.5 hours as overtime
                otHours += (workedMinutes - standardWorkdayDurationMinutes) / 60;
            }
        }
    }


    // Ensure overTime and lessHours are not negative and are fixed to 2 decimal places
    return {
        overTime: parseFloat(Math.max(0, otHours).toFixed(2)),
        lessHours: parseFloat(Math.max(0, lessHours).toFixed(2))
    };
};

export default function App() {
    return (
        <div className="app-main-wrapper">
            <AttendanceTracker />
        </div>
    );
}

const AttendanceTracker = () => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [attendanceData, setAttendanceData] = useState([]);
    const [baseSalary, setBaseSalary] = useState(8500);
    const [isLoading, setIsLoading] = useState(true);
    const [newEmployeeName, setNewEmployeeName] = useState('');

    const [allAttendanceRecords, setAllAttendanceRecords] = useState({});

    useEffect(() => {
        try {
            const storedEmployees = JSON.parse(localStorage.getItem('employees_data')) || [];
            const storedAttendanceRecords = JSON.parse(localStorage.getItem('attendance_records')) || {};

            setAllAttendanceRecords(storedAttendanceRecords);

            if (storedEmployees.length === 0) {

                const defaultEmployee = { id: 'default-employee-1', name: 'John Doe' };
                setEmployees([defaultEmployee]);
                setSelectedEmployee(defaultEmployee.id);
                localStorage.setItem('employees_data', JSON.stringify([defaultEmployee]));
            } else {
                setEmployees(storedEmployees);

                const lastSelected = localStorage.getItem('last_selected_employee_id');
                if (lastSelected && storedEmployees.some(emp => emp.id === lastSelected)) {
                    setSelectedEmployee(lastSelected);
                } else {
                    setSelectedEmployee(storedEmployees[0].id);
                }
            }
        } catch (error) {
            console.error("Error loading data from localStorage:", error);

            const defaultEmployee = { id: 'default-employee-1', name: 'Sukh sagar industries' };
            setEmployees([defaultEmployee]);
            setSelectedEmployee(defaultEmployee.id);
            setAllAttendanceRecords({});
            localStorage.setItem('employees_data', JSON.stringify([defaultEmployee]));
            localStorage.setItem('attendance_records', JSON.stringify({}));
        } finally {
            setIsLoading(false);
        }
    }, []);


    const updateMonthRecord = (employeeId, year, month, daysData, salaryValue) => {

        const monthDocId = `${year}-${month}`;
        setAllAttendanceRecords(prevRecords => ({
            ...prevRecords,
            [employeeId]: {
                ...(prevRecords[employeeId] || {}),
                [monthDocId]: { days: daysData, baseSalary: salaryValue }
            }
        }));
    };

    useEffect(() => {
        if (!selectedEmployee || isLoading) return;

        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const monthDocId = `${year}-${month + 1}`;

        const employeeRecords = allAttendanceRecords[selectedEmployee] || {};
        const currentMonthData = employeeRecords[monthDocId];

        if (currentMonthData) {
            setAttendanceData(currentMonthData.days || []);
            setBaseSalary(currentMonthData.baseSalary || 8500);
        } else {

            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const newMonthDays = Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const monthPadded = String(month + 1).padStart(2, '0');
                const dayPadded = String(day).padStart(2, '0');
                const dateString = `${year}-${monthPadded}-${dayPadded}`;

                return {
                    date: dateString,
                    inTime: '',
                    outTime: '',
                    overTime: 0,
                    lessHours: 0, // Initialize lessHours
                    remarks: ''
                };
            });
            setAttendanceData(newMonthDays);
            setBaseSalary(8500);


            updateMonthRecord(selectedEmployee, year, month + 1, newMonthDays, 8500);
        }
        localStorage.setItem('last_selected_employee_id', selectedEmployee);

    }, [selectedEmployee, currentDate, isLoading]);


    useEffect(() => {
        if (!isLoading) {
            try {
                localStorage.setItem('attendance_records', JSON.stringify(allAttendanceRecords));
            } catch (error) {
                console.error("Error saving attendance_records to localStorage:", error);
                alert("Error saving attendance data locally. Data might not persist.");
            }
        }
    }, [allAttendanceRecords, isLoading]);


    useEffect(() => {
        if (!isLoading) {
            try {
                localStorage.setItem('employees_data', JSON.stringify(employees));
            } catch (error) {
                console.error("Error saving employees_data to localStorage:", error);
                alert("Error saving employee list locally. Data might not persist.");
            }
        }
    }, [employees, isLoading]);


    const handleMonthChange = (offset) => {
        setCurrentDate(prevDate => {
            const newDate = new Date(prevDate);
            newDate.setMonth(newDate.getMonth() + offset);
            return newDate;
        });
    };

    const handleDataChange = (index, field, value) => {
        const updatedData = [...attendanceData];
        const currentRow = { ...updatedData[index] };

        currentRow[field] = value;


        if (field === 'inTime' || field === 'outTime') {
            const { overTime, lessHours } = calculateWorkDetails(currentRow.inTime, currentRow.outTime, currentRow.date);
            currentRow.overTime = overTime;
            currentRow.lessHours = lessHours;
        } else if (field === 'overTime') {

            currentRow.overTime = value === '' ? '' : parseFloat(value) || 0;
        }

        updatedData[index] = currentRow;
        setAttendanceData(updatedData);


        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        updateMonthRecord(selectedEmployee, year, month, updatedData, baseSalary);
    };

    const handleBaseSalaryChange = (value) => {
        const newSalary = parseFloat(value) || 0;
        setBaseSalary(newSalary);


        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        updateMonthRecord(selectedEmployee, year, month, attendanceData, newSalary);
    };

    const handleSave = () => {
        alert('Data saved locally!');
    };

    const handleAddEmployee = (e) => {
        e.preventDefault();
        if (!newEmployeeName.trim()) return;

        const newId = `emp-${Date.now()}`;
        const newEmployee = { id: newId, name: newEmployeeName.trim() };

        setEmployees(prevEmployees => [...prevEmployees, newEmployee]);
        setNewEmployeeName('');
        setSelectedEmployee(newId);
    };

    const handleDeleteEmployee = () => {
        if (!selectedEmployee) {
            alert("No employee selected to delete.");
            return;
        }

        const employeeToDelete = employees.find(emp => emp.id === selectedEmployee);
        if (!employeeToDelete) {
            alert("Selected employee not found.");
            return;
        }

        const confirmDelete = window.confirm(
            `Are you sure you want to delete employee "${employeeToDelete.name}" and ALL their attendance data? This action cannot be undone.`
        );

        if (!confirmDelete) return;


        const updatedEmployees = employees.filter(emp => emp.id !== selectedEmployee);
        setEmployees(updatedEmployees);


        setAllAttendanceRecords(prevRecords => {
            const newRecords = { ...prevRecords };
            delete newRecords[selectedEmployee];
            return newRecords;
        });


        if (updatedEmployees.length > 0) {
            setSelectedEmployee(updatedEmployees[0].id);
        } else {
            setSelectedEmployee('');
        }

        alert(`Employee "${employeeToDelete.name}" and all associated data deleted successfully!`);
    };


    return (
        <div className="app-container">
            <Header />
            <Controls
                employees={employees}
                selectedEmployee={selectedEmployee}
                setSelectedEmployee={setSelectedEmployee}
                currentDate={currentDate}
                handleMonthChange={handleMonthChange}
                handleSave={handleSave}
                newEmployeeName={newEmployeeName}
                setNewEmployeeName={setNewEmployeeName}
                handleAddEmployee={handleAddEmployee}
                handleDeleteEmployee={handleDeleteEmployee}
            />
            {isLoading ? (
                <div className="loading-table-data">
                    <div className="loading-table-spinner"></div>
                    <p className="loading-table-message">Loading Local Data...</p>
                </div>
            ) : (
                <div className="attendance-table-container">
                    <div className="table-wrapper">
                        <AttendanceTable data={attendanceData} onDataChange={handleDataChange} />
                    </div>
                    <Summary
                        data={attendanceData}
                        baseSalary={baseSalary}
                        setBaseSalary={handleBaseSalaryChange}
                        currentDate={currentDate}
                    />
                </div>
            )}
            <Footer />
        </div>
    );
};


const Header = () => (
    <header className="header-section">
        <h1 className="header-title">Employee Attendance Recorder</h1>
        <p className="header-subtitle">A modern way to track monthly attendance and payroll.</p>
    </header>
);

const Controls = ({ employees, selectedEmployee, setSelectedEmployee, currentDate, handleMonthChange, handleSave, newEmployeeName, setNewEmployeeName, handleAddEmployee, handleDeleteEmployee }) => (
    <div className="controls-section">
        <div className="employee-group">
            <label htmlFor="employee-select" className="label-icon"><User className="lucide-icon" /> Employee</label>
            <select
                id="employee-select"
                className="employee-select"
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                disabled={!employees.length}
            >
                {employees.length === 0 && <option value="">No Employees</option>}
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
            <form onSubmit={handleAddEmployee} className="add-employee-form">
                <input
                    type="text"
                    value={newEmployeeName}
                    onChange={(e) => setNewEmployeeName(e.target.value)}
                    placeholder="Add New Employee"
                    className="add-employee-input"
                />
                <button type="submit" className="add-employee-button" disabled={!newEmployeeName.trim()}>
                    <Plus className="lucide-icon" />
                </button>
            </form>
        </div>

        <div className="month-picker-group">
            <label className="label-icon"><Calendar className="lucide-icon" /> Month & Year</label>
            <div className="month-picker-controls">
                <button onClick={() => handleMonthChange(-1)} className="month-nav-button">
                    <ArrowLeft className="lucide-icon" />
                </button>
                <span className="month-display">
                    {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                </span>
                <button onClick={() => handleMonthChange(1)} className="month-nav-button">
                    <ArrowRight className="lucide-icon" />
                </button>
            </div>
        </div>

        <div className="action-buttons-group">
            <button
                onClick={handleSave}
                className="save-button"
            >
                <Save className="lucide-icon" />
                Save Data
            </button>
            <button
                onClick={handleDeleteEmployee}
                className="delete-button"
                disabled={!selectedEmployee || employees.length <= 1}
            >
                <Trash2 className="lucide-icon" />
                Delete Employee
            </button>
        </div>
    </div>
);

const AttendanceTable = ({ data, onDataChange }) => (
    <table className="attendance-table">
        <thead>
            <tr>
                {['Date', 'In Time', 'Out Time', 'Over Time', 'Less Hours', 'Remarks'].map(header => (
                    <th key={header} scope="col">
                        {header}
                    </th>
                ))}
            </tr>
        </thead>
        <tbody>
            {data.map((row, index) => {
                const dayDate = new Date(row.date + 'T00:00:00Z');
                const isSunday = dayDate.getUTCDay() === 0;
                return (
                    <tr key={row.date} className={isSunday ? 'sunday-row' : ''}>
                        <td className="date-cell">
                            {new Date(row.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </td>
                        <td><EditableCell value={row.inTime} onChange={(val) => onDataChange(index, 'inTime', val)} placeholder="HH:MM" /></td>
                        <td><EditableCell value={row.outTime} onChange={(val) => onDataChange(index, 'outTime', val)} placeholder="HH:MM" /></td>
                        <td><EditableCell type="number" value={row.overTime} onChange={(val) => onDataChange(index, 'overTime', val)} /></td>
                        <td><EditableCell type="number" value={row.lessHours} onChange={(val) => onDataChange(index, 'lessHours', val)} /></td>
                        <td><EditableCell value={row.remarks} onChange={(val) => onDataChange(index, 'remarks', val)} /></td>
                    </tr>
                );
            })}
        </tbody>
    </table>
);

const EditableCell = ({ value, onChange, type = 'text', placeholder = '' }) => (
    <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="editable-cell-input"
        placeholder={placeholder}
        {...(type === 'number' && { min: "0", step: "0.01" })}
    />
);

const Summary = ({ data, baseSalary, setBaseSalary, currentDate }) => {
    const summaryStats = useMemo(() => {
        let presentDays = 0;
        let absentDays = 0;
        let totalOvertimeHours = 0;
        let totalLessHours = 0;


        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const actualDaysInMonth = new Date(year, month + 1, 0).getDate();

        // Hourly rate for ALL financial calculations is based on 8.5 hours
        const STANDARD_HOURS_PER_DAY = 8.5;

        let dynamicOtRate = 0;
        if (baseSalary > 0 && actualDaysInMonth > 0) {
            const dailyRate = baseSalary / actualDaysInMonth;
            const hourlyRate = dailyRate / STANDARD_HOURS_PER_DAY;
            dynamicOtRate = parseFloat(hourlyRate.toFixed(2));
        }


        data.forEach(d => {
            const day = new Date(d.date + 'T00:00:00Z').getUTCDay();
            const isSunday = day === 0;

            const hasValidTimeEntry = d.inTime && d.inTime.trim() !== '' && d.inTime.toUpperCase() !== 'H';
            const isHolidayMarked = d.inTime.toUpperCase() === 'H' || d.outTime.toUpperCase() === 'H';


            if (isSunday && !isHolidayMarked) {
                presentDays++;
            } else if (!isSunday && hasValidTimeEntry) {
                presentDays++;
            } else if (!isSunday && !hasValidTimeEntry && !isHolidayMarked) {
                absentDays++;
            }


            if (typeof d.overTime === 'number' && d.overTime > 0) {
                totalOvertimeHours += d.overTime;
            }
            if (typeof d.lessHours === 'number' && d.lessHours > 0) {
                totalLessHours += d.lessHours;
            }
        });

        const otAmount = totalOvertimeHours * dynamicOtRate;


        const dailyRateForDeduction = baseSalary > 0 && actualDaysInMonth > 0 ? baseSalary / actualDaysInMonth : 0;
        const absentDeduction = absentDays * dailyRateForDeduction;

        const lessHoursDeduction = totalLessHours * dynamicOtRate;

        const totalSalary = baseSalary + otAmount - absentDeduction - lessHoursDeduction;

        return {
            present: presentDays,
            absent: absentDays,
            totalOT: totalOvertimeHours,
            totalLessHours: totalLessHours,
            otAmount: otAmount,
            totalSalary: totalSalary,
            currentOtRate: dynamicOtRate,
            absentDeduction: absentDeduction,
            lessHoursDeduction: lessHoursDeduction
        };
    }, [data, baseSalary, currentDate]);

    return (
        <div className="summary-section">
            <SummaryItem label="Absent" value={summaryStats.absent} />
            <SummaryItem label="Present" value={summaryStats.present} />
            <SummaryItem label="Base Salary">
                <input
                    type="number"
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(e.target.value)}
                    className="base-salary-input"
                    min="0"
                    step="0.01"
                />
            </SummaryItem>
            <SummaryItem label="Hourly Rate" value={`₹${summaryStats.currentOtRate.toFixed(2)}`} />
            <SummaryItem label="Total OT (Hours)" value={summaryStats.totalOT.toFixed(2)} />
            <SummaryItem label="Total Less Hours" value={summaryStats.totalLessHours.toFixed(2)} />
            <SummaryItem label="Total OT (Amount)" value={`₹${summaryStats.otAmount.toFixed(2)}`} />
            <SummaryItem label="Absent Deduction" value={`- ₹${summaryStats.absentDeduction.toFixed(2)}`} />
            <SummaryItem label="Less Hours Deduction" value={`- ₹${summaryStats.lessHoursDeduction.toFixed(2)}`} />
            <div className="total-payable-container">
                <SummaryItem label="Total Payable" value={`₹${summaryStats.totalSalary.toFixed(2)}`} isTotal={true} />
            </div>
        </div>
    );
};

const SummaryItem = ({ label, value, children, isTotal = false }) => (
    <div className={`summary-item ${isTotal ? 'total-payable' : ''}`}>
        <p className={`summary-label ${isTotal ? 'total-label' : ''}`}>{label}</p>
        {value !== undefined && <p className={`summary-value ${isTotal ? 'total-value' : ''}`}>{value}</p>}
        {children}
    </div>
);

const Footer = () => (
    <footer className="app-footer">
        <p>Data is stored locally in your browser.</p>
        <p>&copy; 2025 Attendance Tracker. All rights reserved.</p>
    </footer>
);
