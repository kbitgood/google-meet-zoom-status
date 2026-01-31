-- Zoom Status Controller for Hammerspoon
-- Controls Zoom presence status and status message via accessibility APIs
-- 
-- NOTE: Due to Zoom's custom UI, keyboard events are required for some interactions.
-- The script minimizes focus-stealing by using accessibility actions where possible
-- and only briefly activating Zoom when keyboard input is needed.

local M = {}

-- ============================================
-- Private Helper Functions
-- ============================================

local function getZoomApp()
    local zoom = hs.application.find("zoom.us")
    if not zoom then
        return nil, "Zoom is not running"
    end
    return zoom
end

local function getZoomAxApp()
    local zoom, err = getZoomApp()
    if not zoom then return nil, err end
    return hs.axuielement.applicationElement(zoom)
end

local function findElementInTree(root, matchFn, maxDepth)
    maxDepth = maxDepth or 20
    
    local function search(el, depth)
        if depth > maxDepth then return nil end
        
        if matchFn(el) then
            return el
        end
        
        local children = el:attributeValue("AXChildren") or {}
        for _, child in ipairs(children) do
            local result = search(child, depth + 1)
            if result then return result end
        end
        return nil
    end
    
    return search(root, 0)
end

local function findTable(window)
    return findElementInTree(window, function(el)
        return el:attributeValue("AXRole") == "AXTable"
    end, 10)
end

local function getWindowByTitle(axApp, title)
    local windows = axApp:attributeValue("AXWindows") or {}
    for _, win in ipairs(windows) do
        if (win:attributeValue("AXTitle") or "") == title then
            return win
        end
    end
    return nil
end

local function getMenuWindow(axApp)
    return getWindowByTitle(axApp, "Menu window")
end

local function sleep(ms)
    hs.timer.usleep(ms * 1000)
end

-- Click an element using AXPress action
local function clickElement(el)
    if el then
        return el:performAction("AXPress")
    end
    return nil
end

-- Find a button by description in a window
local function findButtonByDesc(window, desc)
    return findElementInTree(window, function(el)
        local role = el:attributeValue("AXRole") or ""
        local elDesc = el:attributeValue("AXDescription") or ""
        return role == "AXButton" and elDesc == desc
    end, 15)
end

-- Get a row's description (from its first cell's first child)
local function getRowDescription(row)
    local cells = row:attributeValue("AXChildren") or {}
    if #cells > 0 then
        local cellChildren = cells[1]:attributeValue("AXChildren") or {}
        if #cellChildren > 0 then
            return cellChildren[1]:attributeValue("AXDescription") or ""
        end
    end
    return ""
end

-- Send a keystroke to Zoom (must already be activated)
local function sendKeystroke(key, modifiers)
    modifiers = modifiers or {}
    hs.eventtap.keyStroke(modifiers, key, 0)
    sleep(50)
end

-- Activate Zoom and return the previous app
local function activateZoom()
    local zoom = hs.application.find("zoom.us")
    local previousApp = hs.application.frontmostApplication()
    if zoom then
        zoom:activate()
        sleep(100)
    end
    return previousApp
end

-- Send a keystroke to Zoom, briefly activating it if needed
local function sendKeystrokeToZoom(key, modifiers)
    modifiers = modifiers or {}
    local zoom = hs.application.find("zoom.us")
    local previousApp = hs.application.frontmostApplication()
    
    -- Briefly activate Zoom
    zoom:activate()
    sleep(50)
    
    -- Send the keystroke
    hs.eventtap.keyStroke(modifiers, key, 0)
    sleep(50)
    
    -- Return to previous app
    if previousApp and previousApp:pid() ~= zoom:pid() then
        previousApp:activate()
    end
end

-- ============================================
-- Core Functions
-- ============================================

-- Find and click the profile button to open the menu
local function openProfileMenu()
    local axApp, err = getZoomAxApp()
    if not axApp then return false, err end
    
    local windows = axApp:attributeValue("AXWindows") or {}
    if #windows == 0 then
        return false, "No Zoom windows found. Is the main window open?"
    end
    
    -- Find the profile button
    local profileButton = nil
    for _, win in ipairs(windows) do
        profileButton = findElementInTree(win, function(el)
            local role = el:attributeValue("AXRole") or ""
            local desc = el:attributeValue("AXDescription") or ""
            return role == "AXButton" and desc:find("^Zoom,") and 
                   (desc:find("Busy") or desc:find("Available") or desc:find("Away") or desc:find("Do Not Disturb") or desc:find("Do not disturb"))
        end, 15)
        if profileButton then break end
    end
    
    if not profileButton then
        return false, "Profile button not found"
    end
    
    -- Click the profile button using accessibility action
    clickElement(profileButton)
    sleep(400)
    
    -- Re-fetch axApp to get updated window list
    axApp = getZoomAxApp()
    
    -- Verify menu appeared
    local menuWindow = getMenuWindow(axApp)
    if not menuWindow then
        return false, "Menu window did not appear"
    end
    
    return true
end

-- Close menus (assumes Zoom is already focused)
local function closeMenus()
    sendKeystroke("escape")
    sleep(100)
end

-- ============================================
-- Public API
-- ============================================

--- Set Zoom presence status
--- @param status string One of: "Available", "Busy", "Do not disturb", "Away", "Out of office"
--- @return boolean success
--- @return string|nil error message
function M.setStatus(status)
    local validStatuses = {
        ["Available"] = true,
        ["Busy"] = true,
        ["Do not disturb"] = true,
        ["Away"] = true,
        ["Out of office"] = true
    }
    
    if not validStatuses[status] then
        return false, "Invalid status: " .. tostring(status)
    end
    
    local axApp, err = getZoomAxApp()
    if not axApp then return false, err end
    
    -- Remember current app to return to and activate Zoom for the duration
    local previousApp = activateZoom()
    
    -- Open profile menu
    local success, openErr = openProfileMenu()
    if not success then 
        if previousApp then previousApp:activate() end
        return false, openErr 
    end
    
    -- Re-fetch axApp after menu open
    axApp = getZoomAxApp()
    
    -- Find the table in the menu
    local menuWindow = getMenuWindow(axApp)
    if not menuWindow then
        if previousApp then previousApp:activate() end
        return false, "Menu window not found"
    end
    
    local tableEl = findTable(menuWindow)
    if not tableEl then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Table not found in menu"
    end
    
    local rows = tableEl:attributeValue("AXRows") or {}
    
    -- Find the status row
    local statusRowIndex = nil
    for i, row in ipairs(rows) do
        local desc = getRowDescription(row)
        if desc == "Busy" or desc == "Available" or desc == "Away" or 
           desc == "Do not disturb" or desc == "Do Not Disturb" or desc == "Out of office" then
            statusRowIndex = i
            break
        end
    end
    
    if not statusRowIndex or not rows[statusRowIndex] then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Status row not found"
    end
    
    -- Select the row and send Enter to open submenu (Zoom is already focused)
    rows[statusRowIndex]:setAttributeValue("AXSelected", true)
    sleep(100)
    sendKeystroke("return")
    sleep(400)
    
    -- Re-fetch axApp to get updated window list
    axApp = getZoomAxApp()
    
    -- Find the status submenu (it's a smaller menu with ~7 rows, first row is "Available")
    local windows = axApp:attributeValue("AXWindows") or {}
    local statusMenuWindow = nil
    for idx, win in ipairs(windows) do
        local title = win:attributeValue("AXTitle") or ""
        if title == "Menu window" then
            local tbl = findTable(win)
            if tbl then
                local r = tbl:attributeValue("AXRows") or {}
                -- Status submenu has ~7 rows (Available, Busy, Do not disturb, Away, Out of office, separator, Reset)
                -- Main menu has 16 rows
                if #r <= 10 and r[1] then
                    local firstRowDesc = getRowDescription(r[1])
                    if firstRowDesc == "Available" then
                        statusMenuWindow = win
                        break
                    end
                end
            end
        end
    end
    
    if not statusMenuWindow then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Status submenu not found"
    end
    
    local statusTable = findTable(statusMenuWindow)
    if not statusTable then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Status table not found"
    end
    
    local statusRows = statusTable:attributeValue("AXRows") or {}
    
    -- Find the target status row
    local targetRowIndex = nil
    for i, row in ipairs(statusRows) do
        local desc = getRowDescription(row)
        if desc == status then
            targetRowIndex = i
            break
        end
    end
    
    if not targetRowIndex or not statusRows[targetRowIndex] then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Status option '" .. status .. "' not found"
    end
    
    -- Select and confirm
    statusRows[targetRowIndex]:setAttributeValue("AXSelected", true)
    sleep(100)
    sendKeystroke("return")
    sleep(200)
    
    -- Return to previous app
    if previousApp and previousApp:bundleID() ~= "us.zoom.xos" then
        previousApp:activate()
    end
    
    return true
end

--- Set Zoom status message
--- @param message string The status message (or empty string to clear)
--- @return boolean success
--- @return string|nil error message
function M.setStatusMessage(message)
    local axApp, err = getZoomAxApp()
    if not axApp then return false, err end
    
    -- Remember current app and activate Zoom
    local previousApp = activateZoom()
    
    -- Open profile menu
    local success, openErr = openProfileMenu()
    if not success then 
        if previousApp then previousApp:activate() end
        return false, openErr 
    end
    
    -- Re-fetch axApp
    axApp = getZoomAxApp()
    
    -- Find the table in the menu
    local menuWindow = getMenuWindow(axApp)
    if not menuWindow then
        if previousApp then previousApp:activate() end
        return false, "Menu window not found"
    end
    
    local tableEl = findTable(menuWindow)
    if not tableEl then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Table not found in menu"
    end
    
    local rows = tableEl:attributeValue("AXRows") or {}
    
    -- Find status message row
    local msgRowIndex = nil
    for i, row in ipairs(rows) do
        local desc = getRowDescription(row)
        if desc == "Status message" then
            msgRowIndex = i
            break
        end
    end
    
    if not msgRowIndex or not rows[msgRowIndex] then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Status message row not found"
    end
    
    -- Select and open
    rows[msgRowIndex]:setAttributeValue("AXSelected", true)
    sleep(100)
    sendKeystroke("return")
    sleep(400)
    
    -- Re-fetch axApp
    axApp = getZoomAxApp()
    
    -- Find the edit dialog
    local editWindow = getWindowByTitle(axApp, "Edit status message")
    if not editWindow then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Edit status message dialog did not appear"
    end
    
    -- Find elements
    local textField = nil
    local saveButton = nil
    local clearButton = nil
    local children = editWindow:attributeValue("AXChildren") or {}
    
    for _, child in ipairs(children) do
        local role = child:attributeValue("AXRole") or ""
        local desc = child:attributeValue("AXDescription") or ""
        local title = child:attributeValue("AXTitle") or ""
        
        if role == "AXTextField" and title == "Status message" then
            textField = child
        elseif role == "AXButton" then
            if desc == "Save" then
                saveButton = child
            elseif desc == "Clear status message" then
                clearButton = child
            end
        end
    end
    
    if not textField then
        closeMenus()
        if previousApp then previousApp:activate() end
        return false, "Status message text field not found"
    end
    
    -- Clear or set message
    if message == "" and clearButton then
        clickElement(clearButton)
        sleep(200)
    else
        if textField:isAttributeSettable("AXValue") then
            textField:setAttributeValue("AXValue", message)
            sleep(100)
        else
            closeMenus()
            if previousApp then previousApp:activate() end
            return false, "Cannot set status message"
        end
        
        -- Use Enter key to save (more reliable than clicking Save button)
        sendKeystroke("return")
        sleep(200)
    end
    
    -- Return to previous app
    if previousApp and previousApp:bundleID() ~= "us.zoom.xos" then
        previousApp:activate()
    end
    
    return true
end

--- Set both status and status message
function M.setStatusAndMessage(status, message)
    local success, err = M.setStatus(status)
    if not success then
        return false, "Failed to set status: " .. (err or "unknown error")
    end
    
    sleep(200)
    
    success, err = M.setStatusMessage(message)
    if not success then
        return false, "Failed to set status message: " .. (err or "unknown error")
    end
    
    return true
end

--- Get current Zoom status
function M.getStatus()
    local axApp, err = getZoomAxApp()
    if not axApp then return nil, err end
    
    local windows = axApp:attributeValue("AXWindows") or {}
    if #windows == 0 then
        return nil, "No Zoom windows found"
    end
    
    for _, win in ipairs(windows) do
        local profileButton = findElementInTree(win, function(el)
            local role = el:attributeValue("AXRole") or ""
            local desc = el:attributeValue("AXDescription") or ""
            return role == "AXButton" and desc:find("^Zoom,")
        end, 15)
        
        if profileButton then
            local desc = profileButton:attributeValue("AXDescription") or ""
            local parts = {}
            for part in desc:gmatch("[^,]+") do
                table.insert(parts, part:match("^%s*(.-)%s*$"))
            end
            if #parts >= 3 then
                return parts[3]
            end
        end
    end
    
    return nil, "Could not determine status"
end

--- Clear status message
function M.clearStatusMessage()
    return M.setStatusMessage("")
end

-- ============================================
-- Convenience Functions
-- ============================================

--- Set status to "In Google Meet" (Busy with message)
function M.setInMeeting()
    return M.setStatusAndMessage("Busy", "In Google Meet")
end

--- Clear "In Google Meet" status
function M.clearInMeeting()
    local success, err = M.setStatus("Available")
    if not success then return false, err end
    
    sleep(200)
    
    return M.clearStatusMessage()
end

-- ============================================
-- HTTP Server for Chrome Extension
-- ============================================

local httpServer = nil
local HTTP_PORT = 17394  -- Random high port for local use

local function jsonEncode(tbl)
    if type(tbl) ~= "table" then
        if type(tbl) == "string" then
            return '"' .. tbl:gsub('"', '\\"'):gsub("\n", "\\n") .. '"'
        elseif type(tbl) == "boolean" or type(tbl) == "number" then
            return tostring(tbl)
        elseif tbl == nil then
            return "null"
        end
        return '"' .. tostring(tbl) .. '"'
    end
    
    local result = "{"
    local first = true
    for k, v in pairs(tbl) do
        if not first then result = result .. "," end
        first = false
        result = result .. '"' .. tostring(k) .. '":' .. jsonEncode(v)
    end
    return result .. "}"
end

local function handleRequest(method, path, headers, body)
    -- CORS headers for Chrome extension
    local corsHeaders = {
        ["Access-Control-Allow-Origin"] = "*",
        ["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS",
        ["Access-Control-Allow-Headers"] = "Content-Type",
        ["Content-Type"] = "application/json"
    }
    
    -- Handle preflight
    if method == "OPTIONS" then
        return "", 204, corsHeaders
    end
    
    -- Route handling
    if path == "/status" and method == "GET" then
        local status, err = M.getStatus()
        if status then
            return jsonEncode({success = true, status = status}), 200, corsHeaders
        else
            return jsonEncode({success = false, error = err or "Unknown error"}), 500, corsHeaders
        end
        
    elseif path == "/meeting/join" and method == "POST" then
        -- Run async to avoid blocking the HTTP server
        hs.timer.doAfter(0.01, function()
            local success, err = M.setInMeeting()
            if not success then
                print("Failed to set meeting status: " .. (err or "unknown"))
            end
        end)
        return jsonEncode({success = true, message = "Status change initiated"}), 202, corsHeaders
        
    elseif path == "/meeting/leave" and method == "POST" then
        -- Run async to avoid blocking the HTTP server
        hs.timer.doAfter(0.01, function()
            local success, err = M.clearInMeeting()
            if not success then
                print("Failed to clear meeting status: " .. (err or "unknown"))
            end
        end)
        return jsonEncode({success = true, message = "Status clear initiated"}), 202, corsHeaders
        
    elseif path == "/health" and method == "GET" then
        return jsonEncode({success = true, service = "zoom-status", version = "1.0"}), 200, corsHeaders
        
    else
        return jsonEncode({success = false, error = "Not found"}), 404, corsHeaders
    end
end

function M.startServer()
    if httpServer then
        print("HTTP server already running on port " .. HTTP_PORT)
        return true
    end
    
    httpServer = hs.httpserver.new()
    httpServer:setPort(HTTP_PORT)
    httpServer:setInterface("localhost")  -- Only accept local connections
    httpServer:setCallback(function(method, path, headers, body)
        local responseBody, statusCode, responseHeaders = handleRequest(method, path, headers, body)
        return responseBody, statusCode, responseHeaders
    end)
    
    local success = httpServer:start()
    if success then
        print("HTTP server started on http://localhost:" .. HTTP_PORT)
        print("")
        print("Endpoints:")
        print("  GET  /health         - Health check")
        print("  GET  /status         - Get current Zoom status")
        print("  POST /meeting/join   - Set status to Busy + 'In Google Meet'")
        print("  POST /meeting/leave  - Set status to Available + clear message")
        return true
    else
        print("Failed to start HTTP server")
        httpServer = nil
        return false
    end
end

function M.stopServer()
    if httpServer then
        httpServer:stop()
        httpServer = nil
        print("HTTP server stopped")
        return true
    end
    return false
end

function M.getServerPort()
    return HTTP_PORT
end

-- ============================================
-- Module Export
-- ============================================

print("Zoom Status Controller loaded!")
print("")
print("  ZoomStatus.setInMeeting()      -- Set Busy + 'In Google Meet'")
print("  ZoomStatus.clearInMeeting()    -- Set Available + clear message")
print("  ZoomStatus.getStatus()         -- Get current status")
print("  ZoomStatus.startServer()       -- Start HTTP server for Chrome extension")
print("  ZoomStatus.stopServer()        -- Stop HTTP server")
print("")

-- Auto-start the server
M.startServer()

ZoomStatus = M
return M
