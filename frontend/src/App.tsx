import React, { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";

// The landing route ships in the entry chunk. Splitting it out meant the browser
// had to fetch a second chunk after parsing the entry, and the Suspense fallback
// below showed through as a blank page for that round trip. It is small; the
// heavy routes are what actually needed splitting.
import Index from "./pages/Index";
// Login ships with the entry too: ProtectedRoute redirects here, and fetching a
// separate 3 kB chunk mid-redirect left the page empty for another round trip.
import Login from "./pages/Login";

// Split per route. ag-grid is ~47% of the bundle and recharts another ~17%, yet
// each is used on a single route — loading both up front made every visitor pay
// for the whole app before the landing page could paint.
const SubmitContent = lazy(() => import("./pages/SubmitContent"));
const TrackStatus = lazy(() => import("./pages/TrackStatus"));
const Analytics = lazy(() => import("./pages/Analytics"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        {/* Route chunks resolve in milliseconds off a warm cache; the blank
            fallback avoids a spinner flashing on every navigation. */}
        <Suspense fallback={<div style={{ minHeight: "100vh" }} />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />

          {/* Protected Route - Requires Login */}
          <Route 
            path="/submit" 
            element={
              <ProtectedRoute>
                <SubmitContent />
              </ProtectedRoute>
            } 
          />
          
          <Route path="/track-status" element={<TrackStatus />} />
          <Route path="/analytics" element={<Analytics />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
