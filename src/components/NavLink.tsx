import { NavLink as RouterNavLink, NavLinkProps } from "react-router-dom";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/routePrefetch";

interface NavLinkCompatProps extends Omit<NavLinkProps, "className"> {
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName, to, onMouseEnter, onFocus, ...props }, ref) => {
    const path = typeof to === "string" ? to : (to as { pathname?: string })?.pathname || "";
    return (
      <RouterNavLink
        ref={ref}
        to={to}
        onMouseEnter={(e) => {
          prefetchRoute(path);
          onMouseEnter?.(e);
        }}
        onFocus={(e) => {
          prefetchRoute(path);
          onFocus?.(e);
        }}
        className={({ isActive, isPending }) =>
          cn(className, isActive && activeClassName, isPending && pendingClassName)
        }
        {...props}
      />
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
