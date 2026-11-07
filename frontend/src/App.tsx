import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { EmptyState } from "./components/ui";
import Chat from "./pages/Chat";
import CollectionDetail from "./pages/CollectionDetail";
import Collections from "./pages/Collections";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import Evaluation from "./pages/Evaluation";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="documents" element={<Documents />} />
        <Route path="collections" element={<Collections />} />
        <Route path="collections/:id" element={<CollectionDetail />} />
        <Route path="chat" element={<Chat />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="evaluation" element={<Evaluation />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<EmptyState icon={null} title="Page not found">That page does not exist.</EmptyState>} />
      </Route>
    </Routes>
  );
}
