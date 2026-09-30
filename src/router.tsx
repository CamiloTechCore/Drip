import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './pages/Home';
import Movimientos from './pages/Movimientos';
import Analisis from './pages/Analisis';
import Mas from './pages/Mas';
export default function AppRoutes(){return <Routes><Route path="/" element={<Home/>}/><Route path="/movimientos" element={<Movimientos/>}/><Route path="/analisis" element={<Analisis/>}/><Route path="/mas" element={<Mas/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
