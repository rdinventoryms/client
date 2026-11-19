# Inventory Management System

A Google Apps Script web app for managing multiple brands. The deployment account owns the Drive storage. Owners work in the app using their brand access key.

## Set up and deploy

1. In a standalone Apps Script project, add Code.gs and Index.html. Under Project Settings, show the manifest and replace appsscript.json with the included manifest. It enables the advanced Drive and Sheets services. For a standard Google Cloud project, enable both APIs in that project as well.
2. Optionally set INITIAL_BRAND_NAME in Script Properties. Select **setupOperator** in the editor and run it as the deploying Google account. Review the requested permissions in Google. The setup creates the **Inventory Management System** root and the first brand workspace. The execution log shows the first inventory Sheet link. Running setup again retrieves the existing workspace.
3. Deploy as a **Web app** with **Execute as Me** and **Who has access Anyone**. For an existing deployment, edit it and select a new version. The deploying owner authorizes Drive once. Other owners open the web-app URL and use their brand access keys without granting Google Drive access. The deploying Google account can enter its initial workspace automatically when Apps Script supplies its active email.

The manifest uses the per-file Drive scope, which grants access to files the app creates or uses. Email scope identifies the deploying account. The external-request permission lets the server fetch the bytes of app-managed images from Google's Drive API.

## Add an owner or a brand

1. In Script Properties, set NEXT_OWNER_EMAIL to the owner's email and NEXT_BRAND_NAME to the workspace name.
2. Run **provisionOwner** in the editor as the deploying account. It creates a separate brand folder and spreadsheet and logs the new owner access key. Share the key privately with that owner along with the web-app URL. Anyone who holds the key can access that workspace, so treat it as a password.
3. To replace a key, set ROTATE_TENANT_ID to the UUID before the period in the old key and run **rotateOwnerKey**. Rotation invalidates that workspace's existing sessions. The same workflow can issue an access key for the initial workspace by using the value of OPERATOR_TENANT as the rotation target.

## Daily use

- Add individual components under **Inventory parts**, then build packages from those components. Package prices are stored in centavos and displayed in Philippine pesos.
- Select **Bulk** to enter the total price and quantity, or **Per Piece** to enter the unit price and quantity purchased. When recording a purchase, enter the count on hand before the delivery and the supplier name. The app adds the purchased quantity. If older units lack a recorded cost, enter an opening unit cost before logging the first purchase against those units.
- Open **Price history** to see recent purchases for a part. The **Purchases** tab contains the full supplier, quantity, unit cost, and weighted-average history. The active unit cost is the remaining inventory value plus the purchase value, divided by the combined quantity. Orders reduce inventory value at the active average.
- Under **Branding**, set the store name, logo, background image or color, and theme and text colors. Image uploads accept JPEG, PNG, or WebP files up to 1 MB.
- Add packages to the cart and adjust quantities. Select **Submit Order** to enter the customer's contact details and log the order. This is an owner action. Orders are written in Philippine pesos to the brand's Orders tab.

## Storage and stock consistency

Each brand spreadsheet contains Settings, Parts, Packages, Purchases, and Orders. Existing brand spreadsheets receive the purchase columns and tab the first time they are accessed after the update. Images live in the same private brand folder. Brand sessions select the spreadsheet server-side.

Submit orders and edit stock through the app so they use the same lock. The app adds the required quantities of parts shared by multiple cart items. It submits the order row and stock deductions together in one Sheets batch. A retry with the same order reference returns the existing order. Editing data directly in Sheets can bypass these checks. Keep the root folder private to avoid granting inherited Drive access across brands.
