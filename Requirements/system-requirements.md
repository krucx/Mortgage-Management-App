Mortgage Management system

To build a jewellery mortgage management system for the loaner to manage and keep track of the different mortgages and payments etc. automatically - with functionality to automatically send reminder for payments,
And which mortgages to call for repayments everyday. Also all information can be combined in a clean UI where the loaner can add customer, new mortgages, payments for one or more existing mortgages, and also a dashboard
to view the KPIs and metrics for the total loan portfolio. Keep it such a way that the data is saved on the loaners laptop only - with functionality of backing it up every Sunday by sending it initially over the mail to the loaners account as attachment

Database Model:
1. Customer : customer_id, customer_name, customer_address, customer_contact_number_1, customer_contact_number_2, reference_name, reference_address, reference_phone_number
2. Mortgage : customer_id, mortgage_id, item_name, item_photo, description, weight, mortgage_amount, current_product_value, rate_of_interest, date_of_mortgage
3. Payments : customer_id, mortgage_id, amount_recieved, payment_date
4. MortgageLedger : mortgage_id, principal, interest, event (Interest added, Payment done)
5. Notices : notice_id, customer_id, mortgage_id, notice_message, notice_date

In the database model - the reference is the person from who we got the loanee - can be an existing customer too
The default rate_of_interest is 3% monthly - compounded yearly (this should be given as a setting to change)
Also create a config table within the same datbase with mapping of the config key to value - set the default rate of interest, frequency and compounding_frequency as some of the config keys with value change option in the UI

The thinking behind the MortgageLedger is to have the point in time dimension for the changes to mortgages so that the same can be shown as calc steps on the UI per mortgage
Please review this design and suggest changes if you deem better

Interest Calculations:
The interest is added on a monthly basis from the date the mortgage was created - For example: 14th of every month. (For 31st and special cases make the interest accrued date to be EOM)
All payments must be interest first and then principal
Simple interest monthly for the year and then compound yearly - make this choosable on the UI while creating the mortgage and also we can edit this while the mortgage is ongoing from the UI

Actions:

View mortgages flow:
- On the UI - the loanee should be able to search and get the details of every mortgage and within that the complete calculation and the history of the changes of principal and interest with events attached and payments etc. linked

Create new Mortgage flow:
- On the UI - if the customer is not present - show name and photo then add the details of the customer, reference and the mortgage
            - if the customer is present - then show the summary of all the mortgages currently held by them and then allow to punch in the new mortgage by adding the mortgage details

Accept payments flow:
- On the UI - using the customer name get the mortgages it has and then allow selection of mutliple mortgages, allow the loanee to enter percentage or individual amount contribution from the lumpsum payment per mortgage
                (by default split equally across basis on the principal and interest left in each)
            - once payment punched - create a receipt and send to the customer phone number in WhatsApp

Edit customer or mortgage flow:
- On the UI allow the loanee to see the customer and mortgage details and give intuitive interface to allow it to edit them safely

Send notices and makes calls for payments flow:
Notice for payments to be sent monthly automatically to the customers 2 days prior to their interest date - have a setting config to send automatically or only after the loanee approves the notifs on the UI
This page should also show a dashboard everyday to show what payments are due that day for making calls thereby showing the customer number to call them

Main Dashboard page:
The loanee should be able to see the full mortgage portfolio here with the appropriate KPIs as the total amount given, payments due today, interest earned, customers, value of the collateral etc.

Requirements:
- Make this a nice frontend application with python backend - with whatsapp messages being sent using chromium on whatsapp web
- Keep the code simple, clean and easy to understand
- For now use a sql lite database with the product and profile photos stored in files separately
- No background computations - to calculate the ledger do it when either there is a get or payment on the mortgage - the interest calculate as soon as the app startups everyday and if it wasnt started for sometime have the functionality to compute the missing dates as well
- Keep it simple



