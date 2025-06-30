import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, addDoc, getDocs, query, deleteDoc } from 'firebase/firestore'; 
import { ArrowLeft, ArrowRight, Calendar, User, Plus, Save, Download } from 'lucide-react'; 
import * as XLSX from 'xlsx'; 

// --- IMPORTANT: Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyCAkkrQHXDCOdp023zAPexRt26AxHysZyI",
  authDomain: "attendance-f2215.firebaseapp.com",
  projectId: "attendance-f2215",
  storageBucket: "attendance-f2215.firebasestorage.app",
  messagingSenderId: "326427156653",
  appId: "1:326427156653:web:39ed8d2227680f1924a624",
  measurementId: "G-394609E266"
};

const __app_id = firebaseConfig.appId;

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
    const dayDate = new Date(dateStr);
    const isSunday = dayDate.getDay() === 0; // Sunday is 0

    // If it's a Sunday or explicitly marked as 'H', no automatic OT
    if (isSunday || inTimeStr.toUpperCase() === 'H' || outTimeStr.toUpperCase() === 'H') {
        return 0;
    }

    const inMinutes = timeToMinutes(inTimeStr);
    const outMinutes = timeToMinutes(outTimeStr);

    if (isNaN(inMinutes) || isNaN(outMinutes)) {
        return 0; // Cannot calculate if times are invalid or missing
    }

    let otHours = 0;

    // Calculate early entry OT (time before 9:00 AM)
    if (inMinutes < STANDARD_START_MINUTES) {
        otHours += (STANDARD_START_MINUTES - inMinutes) / 60;
    }

    // Calculate late exit OT (time after 5:30 PM)
    if (outMinutes > STANDARD_END_MINUTES) {
        otHours += (outMinutes - STANDARD_END_MINUTES) / 60;
    }
    
    return parseFloat(otHours.toFixed(2)); // Round to 2 decimal places
};

// --- Main App Component ---
export default function App() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId, setAppId] = useState('default-app-id');

    useEffect(() => {
        if (typeof __app_id !== 'undefined') {
            setAppId(__app_id);
        }

        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const authInstance = getAuth(app);
        setDb(firestore);
        setAuth(authInstance);

        const unsubscribe = onAuthStateChanged(authInstance, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                signInAnonymously(authInstance).catch(error => {
                    console.error("Anonymous sign-in failed:", error);
                });
            }
            setIsAuthReady(true);
        });

        return () => unsubscribe();
    }, []);

    if (!isAuthReady || !db) {
        return (
            <div className="loading-screen">
                <div className="loading-text-container">
                    <div className="loading-spinner"></div>
                    <h2 className="loading-title">Initializing Attendance Tracker...</h2>
                    <p className="loading-message">Please wait a moment.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app-main-wrapper">
            <AttendanceTracker db={db} appId={appId} userId={userId} />
        </div>
    );
}

// --- Attendance Tracker Component ---
const AttendanceTracker = ({ db, appId, userId }) => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [attendanceData, setAttendanceData] = useState([]);
    const [baseSalary, setBaseSalary] = useState(8500);
    const [isLoading, setIsLoading] = useState(true);
    const [newEmployeeName, setNewEmployeeName] = useState('');

    const OT_RATE = 35.41; // Overtime rate per hour

    const getCollectionPath = useMemo(() => (collectionName) => `/artifacts/${appId}/public/data/${collectionName}`, [appId]);

    // --- Fetch Employees ---
    useEffect(() => {
        if (!db || !appId) return;
        const employeesColPath = getCollectionPath('employees');
        const q = query(collection(db, employeesColPath));

        const unsubscribe = onSnapshot(q, async (querySnapshot) => {
            if (querySnapshot.empty) {
                const defaultEmployee = { name: 'John Doe' };
                try {
                    const docRef = await addDoc(collection(db, employeesColPath), defaultEmployee);
                    setEmployees([{ id: docRef.id, ...defaultEmployee }]);
                    setSelectedEmployee(docRef.id);
                } catch (e) {
                    console.error("Error adding default employee: ", e);
                }
            } else {
                const fetchedEmployees = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setEmployees(fetchedEmployees);
                if (!selectedEmployee || !fetchedEmployees.some(emp => emp.id === selectedEmployee)) {
                    // If selected employee is empty or no longer exists, select the first one
                    if (fetchedEmployees.length > 0) {
                        setSelectedEmployee(fetchedEmployees[0].id);
                    } else {
                        setSelectedEmployee(''); // No employees left
                    }
                }
            }
        });
        return () => unsubscribe();
    }, [db, appId, selectedEmployee, getCollectionPath]);

    // --- Generate or Fetch Attendance Data ---
    useEffect(() => {
        if (!selectedEmployee || !db) return;

        setIsLoading(true);
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const docId = `${year}-${month + 1}`;
        const attendanceDocPath = `${getCollectionPath('employees')}/${selectedEmployee}/attendance/${docId}`;
        const docRef = doc(db, attendanceDocPath);

        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                console.log("Fetched data:", data); // Log fetched data
                setAttendanceData(data.days || []);
                setBaseSalary(data.baseSalary || 8500);
            } else {
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const newMonthData = Array.from({ length: daysInMonth }, (_, i) => {
                    const dayDate = new Date(year, month, i + 1);
                    return {
                        date: dayDate.toISOString().split('T')[0],
                        inTime: '',
                        outTime: '',
                        overTime: 0, // Initialize OT to 0
                        remarks: ''
                    };
                });
                setAttendanceData(newMonthData);
                setBaseSalary(8500);
            }
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching attendance data:", error); // Log fetching errors
            setIsLoading(false);
        });

        return () => unsubscribe();

    }, [selectedEmployee, currentDate, db, getCollectionPath]);

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
        const currentRow = { ...updatedData[index] }; // Create a mutable copy of the row

        // Update the specific field first
        currentRow[field] = value;

        // Apply automatic OT calculation if inTime or outTime changed
        if (field === 'inTime' || field === 'outTime') {
            const newOT = calculateOvertime(currentRow.inTime, currentRow.outTime, currentRow.date);
            currentRow.overTime = newOT; // Automatically update overTime
        } else if (field === 'overTime') {
            // If user manually changes OT, allow it and parse it correctly
            currentRow.overTime = value === '' ? '' : parseFloat(value) || 0;
        } else if (field === 'baseSalary') {
            setBaseSalary(parseFloat(value) || 0); // Update baseSalary state directly
        }

        updatedData[index] = currentRow; // Put the updated row back
        setAttendanceData(updatedData);
    };

    const handleSave = async () => {
        if (!selectedEmployee || !db) {
            alert("Cannot save. No employee selected or database not initialized.");
            return;
        }
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const docId = `${year}-${month + 1}`;
        const attendanceDocPath = `${getCollectionPath('employees')}/${selectedEmployee}/attendance/${docId}`;
        const docRef = doc(db, attendanceDocPath);

        try {
            console.log("Attempting to save data:", { days: attendanceData, baseSalary }); // Log data before saving
            await setDoc(docRef, { days: attendanceData, baseSalary });
            alert('Attendance saved successfully!');
        } catch (error) {
            console.error("Error saving attendance: ", error);
            alert('Error saving attendance. Check console for details (e.g., Firestore rules).');
        }
    };

    const handleAddEmployee = async (e) => {
        e.preventDefault();
        if (!newEmployeeName.trim() || !db) return;
        try {
            const employeesColPath = getCollectionPath('employees');
            const docRef = await addDoc(collection(db, employeesColPath), { name: newEmployeeName });
            setNewEmployeeName('');
            setSelectedEmployee(docRef.id); 
        } catch (error) {
            console.error("Error adding new employee: ", error);
        }
    };

    const handleDeleteEmployee = async () => {
        if (!selectedEmployee || !db) {
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

        try {
            setIsLoading(true); 

            const employeeDocRef = doc(db, getCollectionPath('employees'), selectedEmployee);

            const attendanceCollectionRef = collection(employeeDocRef, 'attendance');
            const attendanceDocsSnapshot = await getDocs(attendanceCollectionRef);

            const deletePromises = [];
            attendanceDocsSnapshot.forEach((docSnap) => {
                deletePromises.push(deleteDoc(docSnap.ref));
            });

            await Promise.all(deletePromises); 

            await deleteDoc(employeeDocRef);

            const updatedEmployeesAfterDeletion = employees.filter(emp => emp.id !== selectedEmployee);
            if (updatedEmployeesAfterDeletion.length > 0) {
                setSelectedEmployee(updatedEmployeesAfterDeletion[0].id);
            } else {
                setSelectedEmployee('');
            }

            alert(`Employee "${employeeToDelete.name}" and all associated data deleted successfully!`);
        } catch (error) {
            console.error("Error deleting employee or attendance data: ", error);
            alert('Error deleting employee. See console for details.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDownloadExcel = async () => {
        if (!db) {
            alert("Database not initialized. Cannot download data.");
            return;
        }

        setIsLoading(true);
        try {
            const employeesColPath = getCollectionPath('employees');
            const employeesSnapshot = await getDocs(collection(db, employeesColPath));
            const allCombinedData = [];

            for (const employeeDoc of employeesSnapshot.docs) {
                const employeeId = employeeDoc.id;
                const employeeName = employeeDoc.data().name;

                const attendanceCollectionRef = collection(doc(db, employeesColPath, employeeId), 'attendance');
                const attendanceSnap = await getDocs(attendanceCollectionRef);

                for (const monthDoc of attendanceSnap.docs) {
                    const monthData = monthDoc.data();
                    const monthDays = monthData.days || [];
                    const monthBaseSalary = monthData.baseSalary || 8500;
                    const monthDocId = monthDoc.id; 

                    let present = 0;
                    let absent = 0;
                    let totalOT = 0;
                    const totalDaysInMonth = monthDays.length;
                    const Sundays = monthDays.filter(d => new Date(d.date).getDay() === 0).length;
                    const actualWorkingDays = totalDaysInMonth - Sundays;

                    monthDays.forEach(d => {
                        const day = new Date(d.date).getDay();
                        const isWorkingDay = day !== 0;

                        if (d.inTime && d.inTime.trim() !== '' && d.inTime.toUpperCase() !== 'H' && d.outTime && d.outTime.trim() !== '' && d.outTime.toUpperCase() !== 'H') {
                            present++;
                        } else if (isWorkingDay && (!d.inTime || d.inTime.trim() === '' || d.inTime.toUpperCase() === 'H')) {
                            // Consider absent if inTime is empty/invalid/H on a working day
                            absent++;
                        }

                        if (typeof d.overTime === 'number' && d.overTime > 0) {
                            totalOT += d.overTime;
                        }
                    });

                    absent = Math.min(absent, actualWorkingDays - present);
                    present = Math.min(present, actualWorkingDays);

                    const otAmount = totalOT * OT_RATE;
                    const totalSalary = monthBaseSalary + otAmount;

                    allCombinedData.push({
                        'Employee Name': employeeName,
                        'Month-Year': monthDocId,
                        'Present Days': present,
                        'Absent Days': absent,
                        'Total OT Hours': totalOT.toFixed(2),
                        'OT Amount (₹)': otAmount.toFixed(2),
                        'Base Salary (₹)': monthBaseSalary.toFixed(2),
                        'Total Payable (₹)': totalSalary.toFixed(2)
                    });
                }
            }

            if (allCombinedData.length === 0) {
                alert("No attendance data found to download.");
                setIsLoading(false);
                return;
            }

            const ws = XLSX.utils.json_to_sheet(allCombinedData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Combined Attendance Summary");
            XLSX.writeFile(wb, "Combined_Attendance_Summary.xlsx");

            alert('Combined attendance data downloaded successfully!');

        } catch (error) {
            console.error("Error downloading combined data: ", error);
            alert('Error downloading combined attendance data. See console for details.');
        } finally {
            setIsLoading(false);
        }
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
                handleSave={handleSave}
                newEmployeeName={newEmployeeName}
                setNewEmployeeName={setNewEmployeeName}
                handleAddEmployee={handleAddEmployee}
                handleDeleteEmployee={handleDeleteEmployee}
                handleDownloadExcel={handleDownloadExcel} 
            />
            {isLoading ? (
                <div className="loading-table-data">
                    <div className="loading-table-spinner"></div>
                    <p className="loading-table-message">Loading Attendance Data...</p>
                </div>
            ) : (
                <div className="attendance-table-container">
                    <div className="table-wrapper">
                        <AttendanceTable data={attendanceData} onDataChange={handleDataChange} />
                    </div>
                    <Summary data={attendanceData} baseSalary={baseSalary} otRate={OT_RATE} setBaseSalary={(value) => handleDataChange(null, 'baseSalary', value)} />
                </div>
            )}
            <Footer userId={userId} appId={appId} />
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

const Controls = ({ employees, selectedEmployee, setSelectedEmployee, currentDate, handleMonthChange, handleSave, newEmployeeName, setNewEmployeeName, handleAddEmployee, handleDeleteEmployee, handleDownloadExcel }) => (
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
                {employees.length === 0 && <option value="">Loading...</option>}
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
                Save Attendance
            </button>
            <button
                onClick={handleDeleteEmployee}
                className="delete-button"
                disabled={!selectedEmployee} 
            >
                Delete Employee
            </button>
            <button
                onClick={handleDownloadExcel}
                className="download-button" 
            >
                <Download className="lucide-icon" />
                Download All Data
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
                const dayDate = new Date(row.date);
                const isSunday = dayDate.getDay() === 0;
                return (
                    <tr key={row.date} className={isSunday ? 'sunday-row' : ''}>
                        <td className="date-cell">
                            {new Date(row.date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
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
        {...(type === 'number' && { min: "0" })}
    />
);

const Summary = ({ data, baseSalary, otRate, setBaseSalary }) => {
    const summaryStats = useMemo(() => {
        let present = 0;
        let absent = 0;
        let totalOT = 0;
        const totalDaysInMonth = data.length;
        const Sundays = data.filter(d => new Date(d.date).getDay() === 0).length;
        const actualWorkingDays = totalDaysInMonth - Sundays;

        data.forEach(d => {
            const day = new Date(d.date).getDay();
            const isWorkingDay = day !== 0;

            if (d.inTime && d.inTime.trim() !== '' && d.inTime.toUpperCase() !== 'H' && d.outTime && d.outTime.trim() !== '' && d.outTime.toUpperCase() !== 'H') {
                present++;
            } else if (isWorkingDay && (!d.inTime || d.inTime.trim() === '' || d.inTime.toUpperCase() === 'H')) {
                absent++;
            }

            if (typeof d.overTime === 'number' && d.overTime > 0) {
                totalOT += d.overTime;
            }
        });

        absent = Math.min(absent, actualWorkingDays - present);
        present = Math.min(present, actualWorkingDays);

        const otAmount = totalOT * otRate;
        const totalSalary = baseSalary + otAmount;

        return { present, absent, totalOT, otAmount, totalSalary };
    }, [data, baseSalary, otRate]);

    return (
        <div className="summary-section">
            <SummaryItem label="Absent" value={summaryStats.absent} />
            <SummaryItem label="Present" value={summaryStats.present} />
            <SummaryItem label="Base Salary">
                 <input
                    type="number"
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(e.target.value)} // Changed to pass event value directly
                    className="base-salary-input"
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

const Footer = ({ userId, appId }) => (
    <footer className="app-footer">
        <p>User ID: {userId || 'N/A'}</p>
        <p>App ID: {appId}</p>
        <p>Data is saved securely in real-time.</p>
    </footer>
);
