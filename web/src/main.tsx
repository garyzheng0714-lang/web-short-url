import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useParams } from "react-router-dom";
import { MotionConfig } from "motion/react";
import "@fontsource-variable/inter";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "./styles.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { consumeSessionTokenFromHash } from "./lib/session";
import { AppShell } from "./app/shell";
import { CreatePage } from "./pages/create";
import { DataPage } from "./pages/data";
import { SettingsPage } from "./pages/settings";

// 旧地址：详情、分组都在「短链访问数据」页的抽屉里（页面都不懒加载，切换不闪加载态）
function LinkRedirect() {
  return <Navigate replace to={`/data?link=${encodeURIComponent(useParams().id || "")}`} />;
}
function GroupRedirect() {
  return <Navigate replace to={`/data?view=groups&g=${encodeURIComponent(useParams().id || "")}`} />;
}

consumeSessionTokenFromHash();

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <CreatePage /> },
      { path: "data", element: <DataPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "links/:id", element: <LinkRedirect /> },
      { path: "groups/:id", element: <GroupRedirect /> },
      { path: "groups", element: <Navigate replace to="/data?view=groups" /> },
      { path: "overview", element: <Navigate replace to="/data" /> },
      { path: "*", element: <Navigate replace to="/" /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </MotionConfig>
  </React.StrictMode>
);
