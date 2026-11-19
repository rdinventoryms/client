# Inventory Management System

A Google Apps Script web app for managing multiple brands. The deployment account owns the Drive storage. Owners work in the app using their brand access key.

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

## Add an owner or a brand

1. In Script Properties, set NEXT_OWNER_EMAIL to the owner's email and NEXT_BRAND_NAME to the workspace name.
2. Run **provisionOwner** in the editor as the deploying account. It creates a separate brand folder and spreadsheet and logs the new owner access key. Share the key privately with that owner along with the web-app URL. Anyone who holds the key can access that workspace, so treat it as a password.
3. To replace a key, set ROTATE_TENANT_ID to the UUID before the period in the old key and run **rotateOwnerKey**. Rotation invalidates that workspace's existing sessions. The same workflow can issue an access key for the initial workspace by using the value of OPERATOR_TENANT as the rotation target.

## Daily use

- Add individual components under **Inventory parts**, then build packages from those components. Package prices are stored in centavos and displayed in Philippine pesos.
- Choose **Edit Part → Edit Part Info** to correct the part name, counted stock, or low-stock threshold. The SKU and supplier are displayed as read-only values. These corrections do not add a purchase entry.
- Choose **Edit Part → Restock** to record a delivery. Use **Bulk** for total price and total quantity, or **Per Item** for unit price and quantity purchased. The app adds the purchased quantity to current stock and logs the part's saved supplier. If older stock lacks a recorded value, use **Set opening unit cost** before saving the restock. Older parts without a saved supplier can still be restocked and are shown as “Supplier not recorded” in the history.
- Open **Price history** to see recent purchases for a part. The **Purchases** tab contains the full supplier, quantity, unit cost, and weighted-average history. The active unit cost is the remaining inventory value plus the purchase value, divided by the combined quantity. Orders reduce inventory value at the active average.
- Under **Branding**, set the store name, logo, background image or color, and theme and text colors. Image uploads accept JPEG, PNG, or WebP files up to 1 MB.
- Add packages to the cart and adjust quantities. Select **Submit Order** to enter the customer's contact details and log the order. This is an owner action. Orders are written in Philippine pesos to the brand's Orders tab.

## Storage and stock consistency

Each brand spreadsheet contains Settings, Parts, Packages, Purchases, and Orders. Existing brand spreadsheets receive the purchase columns and tab the first time they are accessed after the update. Images live in the same private brand folder. Brand sessions select the spreadsheet server-side.

Submit orders and edit stock through the app so they use the same lock. The app adds the required quantities of parts shared by multiple cart items. It submits the order row and stock deductions together in one Sheets batch. A retry with the same order reference returns the existing order. Editing data directly in Sheets can bypass these checks. Keep the root folder private to avoid granting inherited Drive access across brands.
