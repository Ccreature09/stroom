"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// Custom mapping for human-friendly labels or custom paths
const routeNameMap: Record<string, string> = {
  warehouses: "Warehouses",
  "people-roles": "People & Roles",
  inventory: "Inventory",
  settings: "Settings",
};

function formatSegmentLabel(segment: string): string {
  // Return explicit mapping if available
  if (routeNameMap[segment.toLowerCase()]) {
    return routeNameMap[segment.toLowerCase()];
  }

  // Handle dynamic numeric IDs (e.g., /warehouses/123 -> #123)
  if (/^\d+$/.test(segment)) {
    return `#${segment}`;
  }

  // Convert kebab-case or snake_case to Title Case
  return segment
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function DynamicBreadcrumb() {
  const pathname = usePathname();

  // Split path into segments and remove empty strings
  const segments = pathname.split("/").filter(Boolean);

  // If we are directly on /warehouses, just render a single non-clickable page label
  if (pathname === "/warehouses") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Warehouses</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {/* Root Home Link */}
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/warehouses">Warehouses</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {segments.map((segment, index) => {
          // Build cumulative path for each segment link
          const url = `/${segments.slice(0, index + 1).join("/")}`;
          const isLast = index === segments.length - 1;
          const label = formatSegmentLabel(segment);

          // Skip rendering the root segment if it matches 'warehouses' at index 0
          if (segment.toLowerCase() === "warehouses" && index === 0) {
            return null;
          }

          return (
            <React.Fragment key={url}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={url}>{label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
