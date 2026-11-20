# Inventory Management System

A Google Apps Script web app for managing multiple brands. The deployment account owns the Drive storage. Owners work in the app using their brand access key.

## GitHub Pages entry point

The static wrapper lives at `docs/index.html`. Its GitHub Pages source is `main` → `/docs`, with the default project URL `https://rdinventoryms.github.io/client/`. If Google gives you a new `/exec` URL, update the `APP_EXEC_URL` value in that file. The public Pages address can stay the same. Add a future `.com` in the repository's Pages custom domain settings and point its DNS to GitHub Pages. [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

The wrapper adds `embed=1` to the frame URL. Apps Script allows framing on that response and keeps its default frame protection for direct visits. Set the optional `APP_PAGE_TITLE` Script Property to customize the direct Apps Script page title. The public wrapper uses its own HTML title. Open the Apps Script `/exec` URL in its own tab if your browser blocks Google sign-in for the system owner inside the frame.

## Update the files and redeploy

### 1. Update your Apps Script project

1. Sign in to [Google Apps Script](https://script.google.com/home) as the account that owns the deployment. Open the existing **Inventory Management System** project to keep its Script Properties, Drive workspaces, and web-app URL. For a first installation, choose **New project**.
2. Open this repository and copy the full contents of **Code.gs** into the project's **Code.gs** file. If the file is missing, use **Add a file → Script** and name it **Code**.
3. Replace **Index.html** in the editor with the repository's **Index.html**. If the file is missing, use **Add a file → HTML** and name it **Index**.
4. Open **Project Settings**, enable **Show appsscript.json manifest file in editor**, then return to **Editor**. Replace the full contents of **appsscript.json** with the repository copy.
5. Click **Save project**. In the editor sidebar, check that **Drive** and **Sheets** appear under **Services**. The manifest enables both. If the script uses a standard Google Cloud project, enable the **Google Drive API** and **Google Sheets API** in that same Cloud project. [Google's advanced services guide](https://developers.google.com/apps-script/guides/services/advanced)
6. On a first installation, optionally set **INITIAL_BRAND_NAME** under **Project Settings → Script Properties**. In the editor, select **setupOperator** and click **Run**. Review and authorize the scopes as the deploying owner. Check the execution log for the first inventory Sheet link. Existing deployments can skip this step. Running setup again retrieves the existing workspace.

### 2. Point the existing deployment at a new version

1. Open **Deploy → Manage deployments** in the same project.
2. Select the active **Web app** deployment and click **Edit** (the pencil).
3. In the **Version** menu, select **New version** and enter a description such as “Separate part editing from restocking.”
4. Confirm **Execute as** is **Me** and **Who has access** is **Anyone**. This lets owners open the app without a Google Drive consent prompt. Brand access keys still protect the individual workspaces.
5. Click **Deploy** and confirm Google reports success. Reopen the existing web-app URL ending in **/exec**. Editing the existing deployment keeps the public URL and deployment ID. [Google's versioned deployment guide](https://developers.google.com/apps-script/concepts/deployments#edit_a_versioned_deployment)

For a first installation, choose **Deploy → New deployment → Web app**, enter a description, select the same **Me** and **Anyone** settings, then click **Deploy** and copy the **/exec** URL. [Google's web-app guide](https://developers.google.com/apps-script/guides/web)

### 3. Verify the release

1. Reload the **/exec** URL. In a private window, confirm the app reaches its owner access-key screen without redirecting to Google sign-in.
2. In a test brand, open **Inventory parts → Edit Part** and confirm the two options. **Edit Part Info** exposes only the name, counted on-hand quantity, and low-stock threshold. **Restock** exposes the purchase type and its amount and quantity fields.
3. Record a test restock in that test brand, then check the on-hand quantity, average unit cost, and **Price history**. Confirm the brand's **Purchases** tab received one row.

The manifest uses the per-file Drive scope, which grants access to files the app creates or uses. Email scope identifies the deploying account. The external-request permission lets the server fetch the bytes of app-managed images from Google's Drive API.

## System Owner Portal

- Sign into Google as the deployment owner. On the app's **Owner sign-in** screen, select **Login as system owner**. If the app opens directly in your inventory workspace, sign out of the workspace first.
- Under **Provision user**, enter the email address and store name. Each new workspace gets its own private Drive subfolder, spreadsheet, and access key. Use **Show key** to retrieve it and share it privately with the intended owner.
- Existing keys stored as hashes appear as **Legacy key**. They still work and can be replaced when access needs to be reissued. Replacing a key invalidates the old key and active sessions for that workspace. The deployment owner's original workspace may show **No key issued** because it supports Google-based entry.

## Daily use

- Add individual components under **Inventory parts** with a supplier name. Enter any opening stock and its **Total On Hand Cost** to calculate **Cost per Piece**. A new part gets a unique SKU prefixed with the current store name's uppercase initials. Parts and consumables share one name list, and package names are checked separately. Both checks ignore capitalization and include archived records.
- In **Add/Edit Package**, enter a selling price and choose the components and quantities. The form totals their active weighted-average unit costs and subtracts the material cost from the selling price to show profit. Parts without an active unit cost leave the total and profit undetermined.
- Package tiles show the selling price, estimated materials cost, and estimated profit. Consumables count toward buildability and stock deductions. Their costs are excluded from the package estimate.
- Under **Inventory parts**, choose **Add Consumable** for shared supplies such as glue or tape. Manage stock and restock it like a regular part. Every new package gets one inventory unit of each active consumable. Choose stock units that reflect what a single kit uses. When editing a package, clear the checkbox beside an attached consumable to remove it from that recipe.
- The **Used in** column lists the active package recipes that use each part. The **Financial Report** includes consumable restocks and previously logged supply expenses under **Consumables and overhead**.
- Each package tile shows how many more kits can be built after reserving components for all current cart items. **View Assembly Details** opens the package photo and lists each required part and its quantity per kit.
- Use **Delete** on a package tile to remove the package from use. The app archives its row in the brand Sheet for order history and keeps the package details on existing orders.
- Use **Delete** under **Inventory parts** to archive a part. If it is in an active package recipe, remove it from the listed packages first. The archived row and purchase records stay in the brand Sheet. Stock returned from an existing order for that part goes back to the archived row.
- Choose **Edit Part → Edit Part Info** to correct the part name, counted stock, or low-stock threshold. The SKU and supplier are displayed as read-only values. These corrections do not add a purchase entry.
- Choose **Edit Part → Restock** to record a delivery. Enter the supplier for each purchase. Use **Bulk** for total price and total quantity to see the calculated **Cost per Piece**, or **Per Item** for unit price and quantity purchased. The app adds the purchased quantity to current stock, logs the supplier on the purchase, and displays that supplier on the part. If older stock lacks a recorded value, use **Set opening unit cost** before saving the restock.
- Open **Price history** to see recent purchases for a part. The **Purchases** tab contains the full supplier, quantity, unit cost, and weighted-average history. The active unit cost is the remaining inventory value plus the purchase value, divided by the combined quantity. Orders reduce inventory value at the active average.
- Use the header gear to open **Branding settings** and set the store name, logo, background image or color, and theme and text colors. Image uploads accept JPEG, PNG, or WebP files up to 1 MB.
- Create an order from **Orders → Add order** or submit the cart. New orders start as **Order Placed**. Edit an order to change its status. The dashboard shows a count of active orders at each of the four statuses.
- Contact and status changes preserve the original order lines and deductions. Package and quantity changes use current recipes and reconcile the component difference, while retaining the original selling price for packages already in the order. Deleting an order returns its recorded components to stock and archives the order row in the brand's Sheet.

## Storage and stock consistency

Each brand spreadsheet contains Settings, Parts, Packages, Purchases, Orders, and Expenses. Existing brand spreadsheets receive new tabs and columns on their first access after an update. Images live in the same private brand folder. Brand sessions select the spreadsheet server-side.

Submit orders and edit stock through the app so they use the same lock. The app adds the required quantities of parts shared by multiple cart items. It submits the order row and stock deductions together in one Sheets batch. A retry with the same order reference returns the existing order. Editing data directly in Sheets can bypass these checks. Keep the root folder private to avoid granting inherited Drive access across brands.
