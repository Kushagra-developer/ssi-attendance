import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, ArrowRight, Calendar, User, Plus, Save, Trash2 } from 'lucide-react'; // Added Trash2 icon

// --- Helper function for time conversion and OT calculation ---
const timeToMinutes = (timeStr) => {
    if (!timeStr || timeStr.trim() === '' || timeStr.toUpperCase() === 'H') return NaN;
    const parts = timeStr.split(':');
    if (parts.length !== 2) return NaN;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return NaN;
    return hours * 60 + minutes;
};

// Standard working hours in minutes from midnight
const STANDARD_START_MINUTES = timeToMinutes('09:00'); // 9:00 AM
const STANDARD_END_MINUTES = timeToMinutes('17:30'); // 5:30 PM

const calculateOvertime = (inTimeStr, outTimeStr, dateStr) => {
    // When creating a Date from dateStr (YYYY-MM-DD), it's crucial to ensure it's treated as UTC
    // or specifically at the start of the day to avoid timezone shifts causing issues,
    // especially with `getDay()`. Appending 'T00:00:00Z' is a good practice.
    const dayDate = new Date(dateStr + 'T00:00:00Z');
    const isSunday = dayDate.getUTCDay() === 0; // Sunday is 0 for getUTCDay()

    // If 'H' is explicitly entered, it's a holiday/non-working for automatic OT, so return 0
    if (inTimeStr.toUpperCase() === 'H' || outTimeStr.toUpperCase() === 'H') {
        return 0;
    }

    const inMinutes = timeToMinutes(inTimeStr);
    const outMinutes = timeToMinutes(outTimeStr);

    if (isNaN(inMinutes) || isNaN(outMinutes)) {
        return 0; // Cannot calculate if times are invalid or missing
    }

    let otHours = 0;

    // Only calculate automatic OT for working days (not Sundays)
    if (!isSunday) {
        // Calculate early entry OT (time BEFORE 9:00 AM)
        if (inMinutes < STANDARD_START_MINUTES) {
            otHours += (STANDARD_START_MINUTES - inMinutes) / 60;
        }

        // Calculate late exit OT (time AFTER 5:30 PM)
        if (outMinutes > STANDARD_END_MINUTES) {
            otHours += (outMinutes - STANDARD_END_MINUTES) / 60;
        }
    } else {
        // As per the requirement "Sunday is a non-working day for automatic OT",
        // we'll return 0 for automatic calculation based on in/out times on Sunday.
        // Manual OT entered by the user will still be handled by the editable cell.
        return 0;
    }

    return parseFloat(otHours.toFixed(2)); // Round to 2 decimal places
};

// --- Main App Component ---
export default function App() {
    return (
        <div className="app-main-wrapper">
            <AttendanceTracker />
        </div>
    );
}

// --- Attendance Tracker Component ---
const AttendanceTracker = () => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [attendanceData, setAttendanceData] = useState([]); // Attendance for the CURRENTLY selected month/employee
    const [baseSalary, setBaseSalary] = useState(8500); // Base salary for the CURRENTLY selected month/employee
    const [isLoading, setIsLoading] = useState(true);
    const [newEmployeeName, setNewEmployeeName] = useState('');

    // Consolidated state for ALL attendance records
    // Structure: { employeeId: { 'YYYY-M': { days: [...], baseSalary: num }, ... }, ... }
    const [allAttendanceRecords, setAllAttendanceRecords] = useState({});

    const OT_RATE = 35.41; // Overtime rate per hour

    // --- Load Data from localStorage on initial mount ---
    useEffect(() => {
        try {
            const storedEmployees = JSON.parse(localStorage.getItem('employees_data')) || [];
            const storedAttendanceRecords = JSON.parse(localStorage.getItem('attendance_records')) || {};

            setAllAttendanceRecords(storedAttendanceRecords);

            if (storedEmployees.length === 0) {
                // If no employees, create a default one
                const defaultEmployee = { id: 'default-employee-1', name: 'John Doe' };
                setEmployees([defaultEmployee]);
                setSelectedEmployee(defaultEmployee.id);
                localStorage.setItem('employees_data', JSON.stringify([defaultEmployee]));
            } else {
                setEmployees(storedEmployees);
                // Try to select previously selected employee or the first one
                const lastSelected = localStorage.getItem('last_selected_employee_id');
                if (lastSelected && storedEmployees.some(emp => emp.id === lastSelected)) {
                    setSelectedEmployee(lastSelected);
                } else {
                    setSelectedEmployee(storedEmployees[0].id);
                }
            }
        } catch (error) {
            console.error("Error loading data from localStorage:", error);
            // Fallback to default if local storage is corrupted
            const defaultEmployee = { id: 'default-employee-1', name: 'John Doe' };
            setEmployees([defaultEmployee]);
            setSelectedEmployee(defaultEmployee.id);
            setAllAttendanceRecords({});
            localStorage.setItem('employees_data', JSON.stringify([defaultEmployee]));
            localStorage.setItem('attendance_records', JSON.stringify({}));
        } finally {
            setIsLoading(false);
        }
    }, []); // Empty dependency array means this runs once on mount

    // --- Centralized function to update a month's record in allAttendanceRecords ---
    const updateMonthRecord = (employeeId, year, month, daysData, salaryValue) => {
        // month is 1-indexed here, as it's for the monthDocId key
        const monthDocId = `${year}-${month}`;
        setAllAttendanceRecords(prevRecords => ({
            ...prevRecords,
            [employeeId]: {
                ...(prevRecords[employeeId] || {}),
                [monthDocId]: { days: daysData, baseSalary: salaryValue }
            }
        }));
    };

    // --- Update current attendance data when selected employee or month changes ---
    useEffect(() => {
        if (!selectedEmployee || isLoading) return; // Wait until initial load is complete

        const year = currentDate.getFullYear();
        const month = currentDate.getMonth(); // getMonth() is 0-indexed (0-11)
        const monthDocId = `${year}-${month + 1}`; // e.g., "2024-7" (1-indexed month for the key)

        const employeeRecords = allAttendanceRecords[selectedEmployee] || {};
        const currentMonthData = employeeRecords[monthDocId];

        if (currentMonthData) {
            setAttendanceData(currentMonthData.days || []);
            setBaseSalary(currentMonthData.baseSalary || 8500); // Ensure baseSalary is loaded
        } else {
            // Generate new month data if it doesn't exist
            // To get the number of days in the current month (0-indexed 'month'),
            // we create a Date object for the 0th day of the *next* month.
            // This effectively rolls back to the last day of the current month.
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const newMonthDays = Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                // Pad month and day with leading zeros for 'YYYY-MM-DD' format
                const monthPadded = String(month + 1).padStart(2, '0'); // Convert back to 1-indexed and pad
                const dayPadded = String(day).padStart(2, '0');
                const dateString = `${year}-${monthPadded}-${dayPadded}`;

                return {
                    date: dateString, // Use the precisely formatted date string
                    inTime: '',
                    outTime: '',
                    overTime: 0,
                    remarks: ''
                };
            });
            setAttendanceData(newMonthDays);
            setBaseSalary(8500); // Default base salary for new months

            // Auto-save this new month structure to allAttendanceRecords using the centralized function
            // Pass month as 1-indexed for the monthDocId key
            updateMonthRecord(selectedEmployee, year, month + 1, newMonthDays, 8500);
        }
        // Save the last selected employee ID for persistence
        localStorage.setItem('last_selected_employee_id', selectedEmployee);

    }, [selectedEmployee, currentDate, isLoading, allAttendanceRecords]); // Depend on allAttendanceRecords for updates

    // --- Save allAttendanceRecords whenever it changes (after initial load) ---
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

    // --- Save employees whenever it changes (after initial load) ---
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

    // --- Handlers ---
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

        // Apply automatic OT calculation if inTime or outTime changed
        if (field === 'inTime' || field === 'outTime') {
            const newOT = calculateOvertime(currentRow.inTime, currentRow.outTime, currentRow.date);
            currentRow.overTime = newOT;
        } else if (field === 'overTime') {
            // If user manually changes OT, allow it and parse it correctly
            currentRow.overTime = value === '' ? '' : parseFloat(value) || 0;
        }

        updatedData[index] = currentRow;
        setAttendanceData(updatedData);

        // Instantly update allAttendanceRecords for the current month using the centralized function
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1; // Pass 1-indexed month for storage key
        updateMonthRecord(selectedEmployee, year, month, updatedData, baseSalary); // Pass current baseSalary
    };

    const handleBaseSalaryChange = (value) => {
        const newSalary = parseFloat(value) || 0;
        setBaseSalary(newSalary);

        // Also update the baseSalary in allAttendanceRecords for the current month
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1; // Pass 1-indexed month for storage key
        updateMonthRecord(selectedEmployee, year, month, attendanceData, newSalary); // Pass current attendanceData
    };

    const handleSave = () => {
        // With localStorage, changes are automatically saved via useEffects.
        // This button acts more as a confirmation/trigger for the save effect if you modify the baseSalary field directly.
        // The attendanceData changes automatically trigger saves in handleDataChange.
        alert('Data saved locally!');
    };

    const handleAddEmployee = (e) => {
        e.preventDefault();
        if (!newEmployeeName.trim()) return;

        const newId = `emp-${Date.now()}`; // Simple unique ID
        const newEmployee = { id: newId, name: newEmployeeName.trim() };

        setEmployees(prevEmployees => [...prevEmployees, newEmployee]);
        setNewEmployeeName('');
        setSelectedEmployee(newId); // Select the new employee
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

        // Remove from employees list
        const updatedEmployees = employees.filter(emp => emp.id !== selectedEmployee);
        setEmployees(updatedEmployees);

        // Remove all their attendance records
        setAllAttendanceRecords(prevRecords => {
            const newRecords = { ...prevRecords };
            delete newRecords[selectedEmployee];
            return newRecords;
        });

        // Select a new employee or clear selection
        if (updatedEmployees.length > 0) {
            setSelectedEmployee(updatedEmployees[0].id);
        } else {
            setSelectedEmployee('');
        }

        alert(`Employee "${employeeToDelete.name}" and all associated data deleted successfully!`);
    };

    // --- Render UI ---
    return (
        <div className="app-container">
            <Header />
            <Controls
                employees={employees}
                selectedEmployee={selectedEmployee}
                setSelectedEmployee={setSelectedEmployee}
                currentDate={currentDate}
                handleMonthChange={handleMonthChange}
                handleSave={handleSave} // Still keep Save button for user confirmation
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
                    <Summary data={attendanceData} baseSalary={baseSalary} otRate={OT_RATE} setBaseSalary={handleBaseSalaryChange} />
                </div>
            )}
            <Footer />
        </div>
    );
};

// --- Sub-Components ---
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
                disabled={!selectedEmployee || employees.length <= 1} // Disable if no employee selected or only one employee left
            >
                <Trash2 className="lucide-icon" /> {/* Using Trash2 for delete */}
                Delete Employee
            </button>
        </div>
    </div>
);

const AttendanceTable = ({ data, onDataChange }) => (
    <table className="attendance-table">
        <thead>
            <tr>
                {['Date', 'In Time', 'Out Time', 'Over Time', 'Remarks'].map(header => (
                    <th key={header} scope="col">
                        {header}
                    </th>
                ))}
            </tr>
        </thead>
        <tbody>
            {data.map((row, index) => {
                // Ensure date is parsed correctly to avoid timezone issues for `getDay()`
                const dayDate = new Date(row.date + 'T00:00:00Z');
                const isSunday = dayDate.getUTCDay() === 0;
                return (
                    <tr key={row.date} className={isSunday ? 'sunday-row' : ''}>
                        <td className="date-cell">
                            {/* Display using a robust date string to avoid local timezone issues for display */}
                            {new Date(row.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </td>
                        <td><EditableCell value={row.inTime} onChange={(val) => onDataChange(index, 'inTime', val)} placeholder="HH:MM" /></td>
                        <td><EditableCell value={row.outTime} onChange={(val) => onDataChange(index, 'outTime', val)} placeholder="HH:MM" /></td>
                        <td><EditableCell type="number" value={row.overTime} onChange={(val) => onDataChange(index, 'overTime', val)} /></td>
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
        // Ensure that numeric input allows empty string for clearing
        {...(type === 'number' && { min: "0", step: "0.01" })} // Added step for decimal OT
    />
);

const Summary = ({ data, baseSalary, otRate, setBaseSalary }) => {
    const summaryStats = useMemo(() => {
        let presentDays = 0;
        let absentDays = 0;
        let totalOvertimeHours = 0;

        data.forEach(d => {
            // Use 'T00:00:00Z' to parse the date as UTC and avoid local timezone effects on getUTCDay()
            const day = new Date(d.date + 'T00:00:00Z').getUTCDay();
            const isWorkingDay = day !== 0; // Assuming Sunday is a non-working day

            const hasValidInTime = d.inTime && d.inTime.trim() !== '' && d.inTime.toUpperCase() !== 'H';
            const hasValidOutTime = d.outTime && d.outTime.trim() !== '' && d.outTime.toUpperCase() !== 'H';
            const isHolidayMarked = d.inTime.toUpperCase() === 'H' || d.outTime.toUpperCase() === 'H';


            if (isWorkingDay) {
                if (hasValidInTime || hasValidOutTime) { // If there's any valid time entry
                    presentDays++;
                } else if (!isHolidayMarked) { // If it's a working day, and no time, and not marked 'H'
                    absentDays++;
                }
            }

            if (typeof d.overTime === 'number' && d.overTime > 0) {
                totalOvertimeHours += d.overTime;
            }
        });

        const otAmount = totalOvertimeHours * otRate;
        const totalSalary = baseSalary + otAmount;

        return {
            present: presentDays,
            absent: absentDays,
            totalOT: totalOvertimeHours,
            otAmount: otAmount,
            totalSalary: totalSalary
        };
    }, [data, baseSalary, otRate]);

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
            <SummaryItem label="OT (Hours)" value={summaryStats.totalOT.toFixed(2)} />
            <SummaryItem label="OT (Amount)" value={`₹${summaryStats.otAmount.toFixed(2)}`} />
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
