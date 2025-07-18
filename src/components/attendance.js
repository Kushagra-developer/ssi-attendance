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

// --- Time Constants for OT and Less Hours calculation (9:00 to 17:30 = 8.5 hours) ---
const STANDARD_WORK_START_MINUTES = timeToMinutes('09:00'); // 9:00 AM
const STANDARD_WORK_END_MINUTES = timeToMinutes('17:30'); // 5:30 PM (17:30)
const STANDARD_WORK_EXPECTED_DURATION_MINUTES = STANDARD_WORK_END_MINUTES - STANDARD_WORK_START_MINUTES; // 8.5 hours = 510 minutes
// --- End Time Constants ---

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
    let totalActualWorkedMinutes = outMinutes - inMinutes;

    // Handle cases where outTime is before inTime (e.g., overnight shifts not handled, or user error)
    if (totalActualWorkedMinutes < 0) {
        totalActualWorkedMinutes = 0; // Treat as no work done for calculation purposes
    }

    // --- Overtime Calculation ---
    if (isSunday) {
        // On Sundays, all worked minutes are considered overtime
        if (totalActualWorkedMinutes > 0) {
            otHours = totalActualWorkedMinutes / 60;
        }
    } else {
        // For weekdays:
        // Calculate potential overtime if total actual worked minutes exceed 8.5 hours
        if (totalActualWorkedMinutes > STANDARD_WORK_EXPECTED_DURATION_MINUTES) {
            let earlyOtMinutes = 0;
            if (inMinutes < STANDARD_WORK_START_MINUTES) {
                earlyOtMinutes = STANDARD_WORK_START_MINUTES - inMinutes;
            }

            let lateOtMinutes = 0;
            if (outMinutes > STANDARD_WORK_END_MINUTES) {
                lateOtMinutes = outMinutes - STANDARD_WORK_END_MINUTES;
            }

            // The total overtime is the sum of early and late OT,
            // but capped by the amount that totalActualWorkedMinutes exceeds STANDARD_WORK_EXPECTED_DURATION_MINUTES
            const excessMinutes = totalActualWorkedMinutes - STANDARD_WORK_EXPECTED_DURATION_MINUTES;
            otHours = Math.min((earlyOtMinutes + lateOtMinutes), excessMinutes) / 60;
        }
    }

    // --- Less Hours Calculation (Weekdays Only) ---
    if (!isSunday) {
        // Calculate less hours only if total actual worked minutes are less than 8.5 hours
        if (totalActualWorkedMinutes < STANDARD_WORK_EXPECTED_DURATION_MINUTES) {
            lessHours = (STANDARD_WORK_EXPECTED_DURATION_MINUTES - totalActualWorkedMinutes) / 60;
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
        } else if (field === 'lessHours') { // Added this else if for clarity, but already handled by the generic case
            currentRow.lessHours = value === '' ? '' : parseFloat(value) || 0;
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
                {['Date', 'In Time', 'Out Time', 'Less Hours', 'Over Time', 'Remarks'].map(header => ( // Changed order for clarity
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
                        <td><EditableCell type="number" value={row.lessHours} onChange={(val) => onDataChange(index, 'lessHours', val)} /></td> {/* Less Hours cell */}
                        <td><EditableCell type="number" value={row.overTime} onChange={(val) => onDataChange(index, 'overTime', val)} /></td> {/* Over Time cell */}
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

        // **CRITICAL CHANGE HERE:** Hourly rate for ALL financial calculations is now based on 8 hours.
        const STANDARD_HOURS_PER_DAY_FOR_HOURLY_RATE = 8; 

        let dynamicRate = 0; // Hourly rate for OT and less hours deduction
        if (baseSalary > 0 && actualDaysInMonth > 0 && STANDARD_HOURS_PER_DAY_FOR_HOURLY_RATE > 0) {
            const dailyRate = baseSalary / actualDaysInMonth;
            const hourlyRate = dailyRate / STANDARD_HOURS_PER_DAY_FOR_HOURLY_RATE;
            dynamicRate = parseFloat(hourlyRate.toFixed(2));
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

        const otAmount = totalOvertimeHours * dynamicRate;


        const dailyRateForDeduction = baseSalary > 0 && actualDaysInMonth > 0 ? baseSalary / actualDaysInMonth : 0;
        const absentDeduction = absentDays * dailyRateForDeduction;

        const lessHoursDeduction = totalLessHours * dynamicRate;

        const totalSalary = baseSalary + otAmount - absentDeduction - lessHoursDeduction;

        return {
            present: presentDays,
            absent: absentDays,
            totalOT: totalOvertimeHours,
            totalLessHours: totalLessHours,
            otAmount: otAmount,
            totalSalary: totalSalary,
            currentRate: dynamicRate,
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
            <SummaryItem label="Hourly Rate" value={`₹${summaryStats.currentRate.toFixed(2)}`} />
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
