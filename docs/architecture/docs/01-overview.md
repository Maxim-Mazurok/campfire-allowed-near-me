# Campfire Allowed Near Me

## Overview

A web application that helps users find the closest NSW state forest where campfires are currently legal. It combines data from multiple government sources (Forestry Corporation NSW, FCNSW closures, RFS fire danger ratings) with geocoding and driving distance calculations to provide a real-time, map-based search experience.

## Key Concepts

- **Solid Fuel Fire Ban**: The primary source of truth for whether campfires are permitted in a given forest area, sourced from Forestry Corporation NSW.
- **Total Fire Ban (TFB)**: NSW-wide or district-level bans declared by the Rural Fire Service that override local permissions.
- **Forest Closures**: Individual forest closure notices from FCNSW that may restrict access or camping.
- **Snapshot Pipeline**: A twice-daily automated process that scrapes, parses, geocodes, enriches, and assembles all data into a single static JSON file served to the frontend.

## Architecture Decisions

See the `decisions/` folder for Architecture Decision Records (ADRs).
