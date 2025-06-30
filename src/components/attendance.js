import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, addDoc, getDocs, query, deleteDoc } from 'firebase/firestore'; 
// Import Lucide React icons here so they are available to sub-components if defined in the same file
import { ArrowLeft, ArrowRight, Calendar, User, Plus, Save } from 'lucide-react'; // <--- THIS LINE IS CRUCIAL


// --- IMPORTANT: Firebase Configuration ---
// This configuration is provided by the environment.
// In a real-world scenario, you would replace this with your own Firebase project config.
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

// --- Main App Component ---
export default function App() {
    // --- State Management ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [appId, setAppId] = useState('default-app-id');

    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        // Set the App ID from the global variable if available
        if (typeof __app_id !== 'undefined') {
            setAppId(__app_id);
        }

        // Initialize Firebase services
        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const authInstance = getAuth(app);
        setDb(firestore);
        setAuth(authInstance);

        // Set up authentication state listener
        const unsubscribe = onAuthStateChanged(authInstance, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                // If no user, sign in anonymously for this session
                signInAnonymously(authInstance).catch(error => {
                    console.error("Anonymous sign-in failed:", error);
                });
            }
            setIsAuthReady(true);
        });

        // Cleanup subscription on unmount
        return () => unsubscribe();
    }, []);

    // --- Render Loading or Main App ---
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
    // --- State Management ---
    const [employees, setEmployees] = useState([]);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [attendanceData, setAttendanceData] = useState([]);
    const [baseSalary, setBaseSalary] = useState(8500);
    const [isLoading, setIsLoading] = useState(true);
    const [newEmployeeName, setNewEmployeeName] = useState('');

    const OT_RATE = 35.41; // Overtime rate per hour

    // --- Firestore Collection Path ---
    const getCollectionPath = useMemo(() => (collectionName) => `/artifacts/${appId}/public/data/${collectionName}`, [appId]);


    // --- Fetch Employees ---
    useEffect(() => {
        if (!db || !appId) return;
        const employeesColPath = getCollectionPath('employees');
        const q = query(collection(db, employeesColPath));

        const unsubscribe = onSnapshot(q, async (querySnapshot) => {
            if (querySnapshot.empty) {
                // If no employees, create a default one
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
                if (!selectedEmployee && fetchedEmployees.length > 0) {
                    // If selected employee no longer exists (e.g., was deleted), select the first one
                    if (!fetchedEmployees.some(emp => emp.id === selectedEmployee)) {
                         setSelectedEmployee(fetchedEmployees[0].id);
                    } else if (!selectedEmployee) { // If nothing was selected initially
                        setSelectedEmployee(fetchedEmployees[0].id);
                    }
                } else if (fetchedEmployees.length === 0) {
                    setSelectedEmployee(''); // No employees left
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
                setAttendanceData(data.days || []);
                setBaseSalary(data.baseSalary || 8500);
            } else {
                // Generate data for the month if it doesn't exist
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const newMonthData = Array.from({ length: daysInMonth }, (_, i) => {
                    const dayDate = new Date(year, month, i + 1);
                    // For Sundays, default to empty strings, allowing user to fill if needed
                    return {
                        date: dayDate.toISOString().split('T')[0],
                        inTime: '',
                        outTime: '',
                        overTime: 0,
                        remarks: ''
                    };
                });
                setAttendanceData(newMonthData);
                setBaseSalary(8500);
            }
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
        if (field === 'overTime') {
            updatedData[index][field] = value === '' ? '' : parseFloat(value) || 0;
        } else {
            updatedData[index][field] = value;
        }
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
            await setDoc(docRef, { days: attendanceData, baseSalary });
            alert('Attendance saved successfully!');
        } catch (error) {
            console.error("Error saving attendance: ", error);
            alert('Error saving attendance. See console for details.');
        }
    };

    const handleAddEmployee = async (e) => {
        e.preventDefault();
        if (!newEmployeeName.trim() || !db) return;
        try {
            const employeesColPath = getCollectionPath('employees');
            const docRef = await addDoc(collection(db, employeesColPath), { name: newEmployeeName });
            setNewEmployeeName('');
            setSelectedEmployee(docRef.id); // Select the new employee
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
            setIsLoading(true); // Show loading state during deletion

            const employeeDocRef = doc(db, getCollectionPath('employees'), selectedEmployee);

            // 1. Delete all attendance documents in the subcollection
            const attendanceCollectionRef = collection(employeeDocRef, 'attendance');
            const attendanceDocsSnapshot = await getDocs(attendanceCollectionRef);

            const deletePromises = [];
            attendanceDocsSnapshot.forEach((docSnap) => {
                deletePromises.push(deleteDoc(docSnap.ref));
            });

            await Promise.all(deletePromises); // Wait for all attendance docs to be deleted

            // 2. Delete the employee document itself
            await deleteDoc(employeeDocRef);

            // Update local state:
            // The onSnapshot listener for employees should automatically update the 'employees' state.
            // We just need to manage the 'selectedEmployee' state here.
            // The listener will re-run and update `employees` list.
            
            // If the deleted employee was the one currently selected, try to select another one
            // or clear selection if no others exist.
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
                handleDeleteEmployee={handleDeleteEmployee} // Pass delete handler
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
                    <Summary data={attendanceData} baseSalary={baseSalary} otRate={OT_RATE} setBaseSalary={setBaseSalary} />
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

const Controls = ({ employees, selectedEmployee, setSelectedEmployee, currentDate, handleMonthChange, handleSave, newEmployeeName, setNewEmployeeName, handleAddEmployee, handleDeleteEmployee }) => (
    <div className="controls-section">
        {/* Employee Selector & Add New */}
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

        {/* Month/Year Picker */}
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

        {/* Save & Delete Buttons Group */}
        <div className="save-delete-buttons-group"> {/* New wrapper for save and delete buttons */}
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
                disabled={!selectedEmployee} // Disable if no employee is selected
            >
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

            if (d.inTime && d.inTime !== 'H' && d.outTime && d.outTime !== 'H' && d.inTime.trim() !== '' && d.outTime.trim() !== '') {
                present++;
            } else if (isWorkingDay && (!d.inTime || d.inTime.trim() === '')) {
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
                    onChange={(e) => setBaseSalary(parseFloat(e.target.value) || 0)}
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